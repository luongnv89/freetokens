"use strict";
/*
 * Behavioral harness for build.py's _APP_JS (issues #13/#14).
 *
 * Runs the site script inside a `node:vm` sandbox with a minimal DOM stub,
 * replays a JSON scenario from stdin, and prints one JSON line per step:
 *
 *   {visible, status, pressed, inputValue, emptyHidden, historyUrls,
 *    locationSearch, events, perf_ms?}
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
    attrs: {},
    listeners: {},
    children: [],
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
      el.children.push(child);
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

function fire(el, type, event) {
  for (const fn of el.listeners[type] || []) fn(event);
}

function runScenario(scenario) {
  const timers = new FakeTimers();

  // --- DOM -------------------------------------------------------------
  const grid = makeElement("ul");
  const items = [];
  const slugOf = new Map();
  for (const spec of scenario.cards) {
    const article = makeElement("article");
    article.attrs["data-category"] = spec.category;
    article.textContent = spec.text;
    const li = makeElement("li");
    li.card = article;
    Object.defineProperty(li, "textContent", {
      get() {
        return article.textContent;
      },
    });
    grid.appendChild(li);
    items.push(li);
    slugOf.set(li, spec.slug);
  }

  const input = makeElement("input");
  input.attrs.id = "ft-search";
  const status = makeElement("p");
  const emptyBox = makeElement("section");
  const resetButton = makeElement("button");
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
    "ft-results-status": status,
    "ft-no-results": emptyBox,
    "ft-reset-filters": resetButton,
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

  const sandbox = {
    URLSearchParams,
    Date,
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
  if (scenario.track_enabled !== false) {
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
        visible: items.filter((li) => !li.hidden).map((li) => slugOf.get(li)),
        status: status.textContent,
        pressed: chips.reduce((acc, chip) => {
          acc[chip.attrs["data-ft-category"] || "all"] =
            chip.attrs["aria-pressed"];
          return acc;
        }, {}),
        inputValue: input.value,
        emptyHidden: emptyBox.hidden,
        historyUrls: historyUrls.slice(),
        locationSearch: location_.search,
        events: events.map((e) => e.slice()),
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
    } else if (step.op === "click_reset") {
      fire(resetButton, "click", {});
    } else if (step.op === "popstate") {
      location_.search = step.search;
      for (const fn of windowListeners.popstate || []) fn({});
    } else if (step.op === "perf_type_settle") {
      const t0 = Date.now();
      input.value = step.value;
      fire(input, "input", {});
      timers.advance(1000);
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
