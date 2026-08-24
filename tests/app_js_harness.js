"use strict";
/*
 * Behavioral harness for build.py's _APP_JS (issues #13/#14, #16, #62).
 *
 * Runs the site script inside a `node:vm` sandbox with a minimal DOM stub,
 * replays a JSON scenario from stdin, and prints one JSON line per step:
 *
 *   {visible, status, pressed, inputValue, emptyHidden, historyUrls,
 *    locationSearch, events, detailLinks, perf_ms?, preventDefaults?,
 *    trafficHidden?, trafficToday?, trafficPeriod?}
 *
 * Clicks bubble along parentNode chains, so the delegated grid listener
 * behind `offer_click` attribution is exercised like a real click.
 *
 * Live traffic scenarios (#62) add scenario.stats_mode ("ok", "http_error",
 * "network_error", "bad_json", "none") plus optional stats_payloads keyed by
 * counter window ("today" when start===end, else "period"); the
 * {"op":"settle"} step drains microtasks so
 * pending fetch promise chains resolve deterministically.
 *
 * Used by tests/test_build.py::NodeAppJsTests; skipped automatically when
 * no runnable node exists on the machine.
 */

const fs = require("fs");
const vm = require("vm");

class FakeTimers {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.tasks = new Map();
  }
  setTimeout(fn, ms) {
    const id = this.nextId++;
    this.tasks.set(id, { fn, at: this.now + (ms || 0) });
    return id;
  }
  clearTimeout(id) {
    this.tasks.delete(id);
  }
  advance(ms) {
    const target = this.now + ms;
    for (;;) {
      let best = null;
      for (const [id, task] of this.tasks) {
        if (task.at <= target && (!best || task.at < best.at)) {
          best = { id, task };
        }
      }
      if (!best) break;
      this.tasks.delete(best.id);
      this.now = Math.max(this.now, best.task.at);
      best.task.fn();
    }
    this.now = target;
  }
}

// Focus tracking. One scenario runs per process, so a module-level "what is
// focused" is enough to model the one browser behaviour that matters here:
// hiding or detaching the focused element resets focus to <body> (null).
let focusedElement = null;

function makeElement(tag) {
  const el = {
    tag,
    tagName: tag.toUpperCase(),
    attrs: {},
    listeners: {},
    children: [],
    parentNode: null,
    value: "",
    textContent: "",
    card: null,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name)
        ? this.attrs[name]
        : null;
    },
    setAttribute(name, value) {
      el.attrs[name] = String(value);
    },
    addEventListener(type, fn) {
      (el.listeners[type] = el.listeners[type] || []).push(fn);
    },
    focus() {
      focusedElement = el;
    },
    appendChild(child) {
      // Real-DOM semantics: appending a node that is already a child MOVES
      // it to the end (the app's re-sort relies on this).
      const idx = el.children.indexOf(child);
      if (idx !== -1) el.children.splice(idx, 1);
      el.children.push(child);
      child.parentNode = el;
      return child;
    },
    querySelectorAll(selector) {
      if (selector === "li") return el.children.slice();
      return [];
    },
    querySelector(selector) {
      if (selector === "[data-category]") return el.card;
      // "#id" lookup over this element's subtree (traffic strip slots).
      const m = /^#([\w-]+)$/.exec(selector);
      if (m) {
        const stack = [...el.children];
        while (stack.length) {
          const node = stack.shift();
          if (node.attrs && node.attrs.id === m[1]) return node;
          stack.push(...(node.children || []));
        }
      }
      return null;
    },
  };
  // Model the browser rule this harness exists to police: hiding the element
  // that currently holds focus resets focus to <body>. Without it a
  // self-hiding control looks fine here while stranding real keyboard users.
  let hiddenState = false;
  Object.defineProperty(el, "hidden", {
    get() {
      return hiddenState;
    },
    set(value) {
      hiddenState = !!value;
      if (hiddenState && focusedElement === el) {
        focusedElement = null;
      }
    },
  });
  return el;
}

// Dispatch `type` on `el` and let it bubble along parentNode chains, so
// delegated container listeners (grid -> offer_click) see the event.
function fire(el, type, event) {
  let node = el;
  while (node) {
    const fns = (node.listeners[type] || []).slice();
    for (const fn of fns) fn(event);
    node = node.parentNode;
  }
}

async function runScenario(scenario) {
  const timers = new FakeTimers();

  // --- DOM -------------------------------------------------------------
  const grid = makeElement("ul");
  // Count row moves. Appending an <li> detaches it first, which in a real
  // browser blurs anything focused inside it, so "did this operation reorder
  // the grid at all" is the observable that pins the focus fix.
  let rowAppends = 0;
  const gridAppendChild = grid.appendChild;
  grid.appendChild = function (child) {
    rowAppends++;
    return gridAppendChild.call(grid, child);
  };
  const items = [];
  const slugOf = new Map();
  const linksBySlug = new Map();
  const detailLinksBySlug = new Map();
  for (const spec of scenario.cards) {
    const article = makeElement("article");
    article.attrs["data-category"] = spec.category;
    // Sort keys (F10): build-time attributes the app re-sorts on.
    article.attrs["data-verified"] = spec.verified || "";
    article.attrs["data-expiry"] = spec.expiry || "";
    article.attrs["data-amount-sort"] =
      spec.amount_sort !== undefined ? String(spec.amount_sort) : "0";
    article.textContent = spec.text;
    const link = makeElement("a");
    link.attrs["href"] =
      "https://provider.example/" + encodeURIComponent(spec.slug);
    link.attrs["data-ft-offer-id"] = spec.slug;
    link.attrs["data-ft-provider"] = spec.provider || spec.slug;
    link.attrs["data-ft-offer-category"] = spec.category;
    article.appendChild(link);
    // Detail affordance (#60): a plain navigational link to the offer's
    // dedicated page. No dialog wiring exists anymore, so its clicks must
    // stay native — never prevented, never tracked.
    const detailLink = makeElement("a");
    detailLink.attrs["href"] =
      "offers/" + encodeURIComponent(spec.slug) + ".html";
    detailLink.attrs["class"] = "detail-btn";
    article.appendChild(detailLink);
    detailLinksBySlug.set(spec.slug, detailLink);
    const li = makeElement("li");
    li.card = article;
    // Parent the card into the list item so click events can bubble
    // link -> article -> li -> grid like they do on the real page.
    li.appendChild(article);
    Object.defineProperty(li, "textContent", {
      get() {
        return article.textContent;
      },
    });
    grid.appendChild(li);
    items.push(li);
    slugOf.set(li, spec.slug);
    linksBySlug.set(spec.slug, link);
  }

  const input = makeElement("input");
  input.attrs.id = "ft-search";
  const status = makeElement("p");
  const emptyBox = makeElement("section");
  const resetButton = makeElement("button");
  resetButton.attrs.id = "ft-reset-filters";
  // The toolbar escape hatch (#99). It hides itself the instant nothing is
  // filtering, so it is the element most likely to vanish under its own focus.
  const clearButton = makeElement("button");
  clearButton.attrs.id = "ft-clear-filters";
  clearButton.hidden = true;
  // Sort select (F10): a value-holding control the app syncs and listens to.
  const sortSelect = makeElement("select");
  sortSelect.attrs.id = "ft-sort";
  sortSelect.value = "";
  const chips = [
    { value: "" },
    ...(scenario.valid_categories || []).map((c) => ({ value: c })),
  ].map(({ value }) => {
    const chip = makeElement("button");
    chip.attrs["data-ft-category"] = value;
    chip.setAttribute("aria-pressed", value ? "false" : "true");
    return chip;
  });

  // Live traffic strip (#62): hidden until the stats module fills it.
  const trafficBox = makeElement("p");
  trafficBox.attrs.id = "ft-traffic";
  trafficBox.hidden = true;
  const trafficToday = makeElement("strong");
  trafficToday.attrs.id = "ft-traffic-today";
  trafficToday.textContent = "\u2014";
  const trafficPeriod = makeElement("strong");
  trafficPeriod.attrs.id = "ft-traffic-period";
  trafficPeriod.textContent = "\u2014";
  trafficBox.appendChild(trafficToday);
  trafficBox.appendChild(trafficPeriod);

  const byId = {
    "ft-grid": grid,
    "ft-search": input,
    "ft-sort": sortSelect,
    "ft-results-status": status,
    "ft-no-results": emptyBox,
    "ft-reset-filters": resetButton,
    "ft-clear-filters": clearButton,
    "ft-traffic": trafficBox,
    "ft-traffic-today": trafficToday,
    "ft-traffic-period": trafficPeriod,
  };

  const location_ = { pathname: "/", search: scenario.init_search || "" };
  const historyUrls = [];
  function setLocation(url) {
    if (url.indexOf("?") === 0) {
      location_.pathname = "/";
      location_.search = url;
    } else {
      location_.pathname = url;
      location_.search = "";
    }
  }

  const windowListeners = {};
  const events = [];
  const meta = { preventDefaults: 0 };
  function clickEvent(target) {
    return {
      target,
      preventDefault() {
        meta.preventDefaults++;
      },
    };
  }

  const sandbox = {
    URLSearchParams,
    // Pin Date to the fake clock so the offer_click double-click window is
    // deterministic under `advance`, while still supporting `new Date(...)`
    // for the live-traffic counter's date-range math (#62).
    Date: class extends Date {
      constructor(...args) {
        super(args.length ? args[0] : timers.now);
      }
      static now() {
        return timers.now;
      }
    },
    console,
    setTimeout: (fn, ms) => timers.setTimeout(fn, ms),
    clearTimeout: (id) => timers.clearTimeout(id),
    document: {
      readyState: "complete",
      // Live, so the app sees focus move exactly as a browser reports it.
      get activeElement() {
        return focusedElement;
      },
      getElementById: (id) => byId[id] || null,
      querySelectorAll: (selector) =>
        selector === "[data-ft-category]" ? chips : [],
      addEventListener() {},
    },
  };
  sandbox.window = sandbox;
  sandbox.location = location_;
  sandbox.history = {
    pushState(state, title, url) {
      historyUrls.push(url);
      setLocation(url);
    },
  };
  sandbox.addEventListener = (type, fn) => {
    (windowListeners[type] = windowListeners[type] || []).push(fn);
  };
  if (scenario.track_mode === "throw") {
    // Simulates an adblocker/gtag failure: the tracker exists but throws.
    sandbox.ftTrackEvent = () => {
      throw new Error("ga blocked");
    };
  } else if (scenario.track_enabled !== false) {
    sandbox.ftTrackEvent = (name, params) => events.push([name, params]);
  }

  // Live traffic (#62): controllable fetch stub routed by counter date range.
  // start===end means "today"; any other range is the 90-day period.
  const statsMode = scenario.stats_mode || "none";
  if (statsMode !== "none") {
    sandbox.fetch = (url) => {
      if (statsMode === "network_error") {
        return Promise.reject(new TypeError("NetworkError"));
      }
      const start = /[?&]start=([^&]+)/.exec(url);
      const end = /[?&]end=([^&]+)/.exec(url);
      const key =
        start && end && start[1] === end[1] ? "today" : "period";
      const payloads = scenario.stats_payloads || {};
      const body = Object.prototype.hasOwnProperty.call(payloads, key)
        ? payloads[key]
        : { count: "0" };
      if (statsMode === "http_error") {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve(body) });
      }
      if (statsMode === "bad_json") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new Error("invalid json")),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    };
  }

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(scenario.app, "utf8"), sandbox, {
    filename: "app.js",
  });

  // --- Steps -----------------------------------------------------------
  function snapshot(extra) {
    return Object.assign(
      {
        // Read DOM order from the grid itself so re-sorts are observable.
        visible: grid.children
          .filter((li) => !li.hidden)
          .map((li) => slugOf.get(li)),
        status: status.textContent,
        pressed: chips.reduce((acc, chip) => {
          acc[chip.attrs["data-ft-category"] || "all"] =
            chip.attrs["aria-pressed"];
          return acc;
        }, {}),
        inputValue: input.value,
        sortValue: sortSelect.value,
        emptyHidden: emptyBox.hidden,
        clearHidden: clearButton.hidden,
        // Cumulative; tests compare deltas across steps.
        rowAppends,
        activeElementId: focusedElement
          ? focusedElement.attrs.id || focusedElement.tag
          : null,
        historyUrls: historyUrls.slice(),
        locationSearch: location_.search,
        events: events.map((e) => e.slice()),
        preventDefaults: meta.preventDefaults,
        detailLinks: [...detailLinksBySlug].reduce(
          (acc, [slug, a]) => {
            acc[slug] = a.attrs.href;
            return acc;
          },
          {}
        ),
        trafficHidden: trafficBox.hidden,
        trafficToday: trafficToday.textContent,
        trafficPeriod: trafficPeriod.textContent,
      },
      extra || {}
    );
  }

  const results = [snapshot()];
  for (const step of scenario.steps || []) {
    const extra = {};
    if (step.op === "type") {
      input.value = step.value;
      fire(input, "input", {});
    } else if (step.op === "advance") {
      timers.advance(step.ms);
    } else if (step.op === "click_chip") {
      const chip = chips.find(
        (c) => (c.attrs["data-ft-category"] || "") === (step.value || "")
      );
      if (!chip) throw new Error(`no chip ${step.value}`);
      fire(chip, "click", { currentTarget: chip });
    } else if (step.op === "click_offer") {
      const link = linksBySlug.get(step.value);
      if (!link) throw new Error(`no offer link ${step.value}`);
      fire(link, "click", clickEvent(link));
    } else if (step.op === "click_detail_link") {
      // Click the card's detail affordance; with dialogs gone it is a
      // plain link, so the click must produce zero scripted side effects.
      const a = detailLinksBySlug.get(step.value);
      if (!a) throw new Error(`no detail link ${step.value}`);
      fire(a, "click", clickEvent(a));
    } else if (step.op === "click_span") {
      // Click a non-anchor child inside the card: must resolve to its
      // enclosing offer link via bubbling.
      const link = linksBySlug.get(step.value);
      if (!link) throw new Error(`no offer link ${step.value}`);
      const span = makeElement("span");
      link.appendChild(span);
      fire(span, "click", clickEvent(span));
    } else if (step.op === "click_grid") {
      // A click that originates on the grid itself: no offer involved.
      fire(grid, "click", clickEvent(grid));
    } else if (step.op === "click_reset") {
      fire(resetButton, "click", {});
    } else if (step.op === "focus") {
      const target = { clear: clearButton, reset: resetButton, search: input };
      focusedElement = target[step.target] || null;
    } else if (step.op === "click_clear") {
      fire(clearButton, "click", {});
    } else if (step.op === "set_sort") {
      // F10: changing the select fires one change event, like a user pick.
      sortSelect.value = step.value;
      fire(sortSelect, "change", { currentTarget: sortSelect });
    } else if (step.op === "popstate") {
      location_.search = step.search;
      for (const fn of windowListeners.popstate || []) fn({});
    } else if (step.op === "perf_type_settle") {
      const t0 = Date.now();
      input.value = step.value;
      fire(input, "input", {});
      timers.advance(1000);
      extra.perf_ms = Date.now() - t0;
    } else if (step.op === "perf_sort") {
      // F10 budget: a full change->sort->apply cycle must stay far under
      // the 200 ms perceived-latency ceiling even with 20+ offers.
      const t0 = Date.now();
      sortSelect.value = step.value;
      fire(sortSelect, "change", { currentTarget: sortSelect });
      extra.perf_ms = Date.now() - t0;
    } else if (step.op === "snapshot") {
      // Snapshots are taken after every step anyway.
    } else if (step.op === "settle") {
      // Drain microtasks so pending fetch promise chains resolve
      // deterministically before the next snapshot.
      for (let i = 0; i < 8; i++) await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
    } else {
      throw new Error(`unknown op ${step.op}`);
    }
    results.push(snapshot(extra));
  }
  return results;
}

(async () => {
  try {
    const scenario = JSON.parse(fs.readFileSync(0, "utf8"));
    process.stdout.write(JSON.stringify(await runScenario(scenario)));
  } catch (err) {
    console.error((err && err.stack) || String(err));
    process.exit(1);
  }
})();
