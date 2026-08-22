"use strict";
/*
 * Behavioral harness for build.py's _APP_JS (issues #13/#14, #16).
 *
 * Runs the site script inside a `node:vm` sandbox with a minimal DOM stub,
 * replays a JSON scenario from stdin, and prints one JSON line per step:
 *
 *   {visible, status, pressed, inputValue, emptyHidden, historyUrls,
 *    locationSearch, events, perf_ms?, preventDefaults?}
 *
 * Clicks bubble along parentNode chains, so the delegated grid listener
 * behind `offer_click` attribution is exercised like a real click.
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

function makeElement(tag) {
  const el = {
    tag,
    tagName: tag.toUpperCase(),
    attrs: {},
    listeners: {},
    children: [],
    parentNode: null,
    hidden: false,
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
      return null;
    },
  };
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

function runScenario(scenario) {
  const timers = new FakeTimers();

  // --- DOM -------------------------------------------------------------
  const grid = makeElement("ul");
  const items = [];
  const slugOf = new Map();
  const linksBySlug = new Map();
  const buttonsBySlug = new Map();
  const dialogsBySlug = new Map();
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
    // Detail trigger (#48): a button sibling of the outbound link, so its
    // clicks bubble to the grid but never resolve to an offer link.
    const btn = makeElement("button");
    btn.attrs["data-ft-detail"] = spec.slug;
    article.appendChild(btn);
    // Build-time dialog stub: the real page ships one <dialog> per offer.
    const dlg = makeElement("dialog");
    dlg.attrs.id = "ft-detail-" + spec.slug;
    dlg.open = false;
    dlg.showModal = () => {
      dlg.open = true;
    };
    buttonsBySlug.set(spec.slug, btn);
    dialogsBySlug.set(spec.slug, dlg);
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

  const byId = {
    "ft-grid": grid,
    "ft-search": input,
    "ft-sort": sortSelect,
    "ft-results-status": status,
    "ft-no-results": emptyBox,
    "ft-reset-filters": resetButton,
  };
  for (const [slug, dlg] of dialogsBySlug) {
    byId["ft-detail-" + slug] = dlg;
  }

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
    // App script only reads Date.now(); pin it to the fake clock so the
    // offer_click double-click window is deterministic under `advance`.
    Date: { now: () => timers.now },
    console,
    setTimeout: (fn, ms) => timers.setTimeout(fn, ms),
    clearTimeout: (id) => timers.clearTimeout(id),
    document: {
      readyState: "complete",
      activeElement: null,
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
        historyUrls: historyUrls.slice(),
        locationSearch: location_.search,
        events: events.map((e) => e.slice()),
        preventDefaults: meta.preventDefaults,
        openDialogs: [...dialogsBySlug]
          .filter(([, dlg]) => dlg.open)
          .map(([slug]) => slug),
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
    } else if (step.op === "click_detail") {
      // Click the card's detail trigger; must bubble to the grid handler.
      const btn = buttonsBySlug.get(step.value);
      if (!btn) throw new Error(`no detail button ${step.value}`);
      fire(btn, "click", clickEvent(btn));
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
    } else {
      throw new Error(`unknown op ${step.op}`);
    }
    results.push(snapshot(extra));
  }
  return results;
}

const scenario = JSON.parse(fs.readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(runScenario(scenario)));
