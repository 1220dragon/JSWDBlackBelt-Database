// Login and database. You don't need to change this file.
//
//   db.insert({ text: "hi" })          insert a document
//   db.load()                          get everything, newest first
//   db.update(thing, { text: "bye" })  update a document you inserted
//   db.delete(thing)                   delete a document
//   db.user()                          who is logged in
//   db.refresh()                       reload the lists
//
// Each thing has your fields plus id, by (who saved it), when, and editedBy
// (the site owner, if they changed someone else's document).
//
// Everything uses the collection in config.js unless you name another one:
//
//   <ul data-list="scores">      a list of scores
//   <form data-insert="scores">  saves into scores
//   db.insert({ name: "Maya" }, { collection: "scores" })
//   db.load({ collection: "scores" })
//
// Update and delete go back to whichever collection the thing came from.

(function () {
  const SITE_URL = API + "/api/v1/site";

  function dataUrl(collection) {
    return API + "/api/v1/data/" + encodeURIComponent(collection || COLLECTION);
  }

  // Which collection each loaded thing came from, so update and delete go back
  // to it. Kept out of the thing itself so it can't clash with your own fields.
  const home = new WeakMap();

  const WAITING = "You are logged in, but the owner of this site has not let you in yet, so you cannot save anything.";

  // Friendlier versions of the server's messages
  const FRIENDLY = {
    login_required:   "Log in first.",
    not_approved_yet: WAITING,
  };

  let session  = remember("session");
  let username = remember("username");
  let approved = null;

  // Talking to the server

  async function ask(url, options = {}) {
    const headers = { "Authorization": "Bearer " + SITE_KEY };
    if (session) headers["X-Site-Session"] = session;
    if (options.body) headers["Content-Type"] = "application/json";

    try {
      const res = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      const error = body.error || {};
      return {
        ok: res.ok,
        body,
        code: error.code || "",
        problem: res.ok ? "" : FRIENDLY[error.code] || error.message || "That did not work.",
      };
    } catch (e) {
      // Offline
      return { ok: false, body: {}, offline: true, problem: "Could not reach the database. Are you online?" };
    }
  }

  function toThing(doc) {
    return Object.assign({}, doc.data, {
      id:   doc.id,
      by:   doc.by,
      when: new Date(doc.createdAt).toLocaleDateString(),
      editedBy: doc.editedBy || null,
    });
  }

  // A new collection starts private, so the first thing most people hit is a
  // list that stays empty. Say where to fix it.
  const ADMIN_HINT = {
    collection_not_found: "Check the spelling, or make it on your HackDB Admin page.",
    read_not_allowed:     "On your HackDB Admin page, change its Member access or turn on Public read.",
    write_not_allowed:    "On your HackDB Admin page, change its Member access.",
  };

  function explain(result) {
    const hint = ADMIN_HINT[result.code];
    return hint ? result.problem + " " + hint : result.problem;
  }

  // What script.js can use

  async function insert(thing, options = {}) {
    const collection = options.collection || COLLECTION;
    const result = await ask(dataUrl(collection), { method: "POST", body: thing });
    if (!result.ok) {
      say(explain(result), "bad", options.from);
      return false;
    }
    approved = true;
    say("Saved!", "ok", options.from);
    refresh();
    return true;
  }

  async function load(options = {}) {
    const collection = options.collection || COLLECTION;
    const params = new URLSearchParams({ limit: options.limit || 50 });
    if (options.sort)  params.set("sort", options.sort);
    if (options.order) params.set("order", options.order);

    const result = await ask(dataUrl(collection) + "?" + params);
    if (!result.ok) {
      const problem = explain(result);
      console.warn("Could not load " + collection + ":", problem);
      // Visitors who aren't logged in, and members still waiting to be let in,
      // are expected to be turned away; anything else is a mistake worth showing.
      const expected = result.code === "login_required" || result.offline || approved === false;
      if (options.from && !expected) {
        say(problem, "bad", options.from);
      }
      return [];
    }
    return result.body.documents.map(doc => {
      const thing = toThing(doc);
      home.set(thing, collection);
      return thing;
    });
  }

  async function update(thing, changes, options = {}) {
    const collection = options.collection || home.get(thing) || COLLECTION;
    const data = Object.assign({}, thing, changes);
    delete data.id;
    delete data.by;
    delete data.when;
    delete data.editedBy;
    const result = await ask(dataUrl(collection) + "/" + thing.id, { method: "PUT", body: data });
    if (result.ok) say("Updated!", "ok", options.from);
    else say(explain(result), "bad", options.from);
    refresh();
    return result.ok;
  }

  async function del(thing, options = {}) {
    const id = typeof thing === "string" ? thing : thing.id;
    const collection = options.collection || (typeof thing === "object" && home.get(thing)) || COLLECTION;
    const result = await ask(dataUrl(collection) + "/" + id, { method: "DELETE" });
    if (!result.ok) say(explain(result), "bad", options.from);
    refresh();
    return result.ok;
  }

  // Logging in and out

  async function logIn(form, signingUp) {
    const { username: nameBox, password: passwordBox } = form.elements;
    if (!nameBox || !passwordBox) {
      return say('The login form needs an input with name="username" and one with name="password".', "bad", form);
    }
    const details = { username: nameBox.value.trim(), password: passwordBox.value };

    if (signingUp) {
      const signup = await ask(SITE_URL + "/signup", { method: "POST", body: details });
      if (!signup.ok) return say(signup.problem, "bad", form);
    }

    const login = await ask(SITE_URL + "/login", { method: "POST", body: details });
    if (!login.ok) return say(login.problem, "bad", form);

    session  = login.body.session;
    username = login.body.username;
    approved = login.body.status === "approved";
    remember("session", session);
    remember("username", username);

    clear(form);
    showWhoIsLoggedIn();
    refresh();
  }

  async function logOut() {
    await ask(SITE_URL + "/logout", { method: "POST" });
    forget();
    showWhoIsLoggedIn();
    refresh();
  }

  function forget() {
    session = username = null;
    approved = false;
    remember("session", null);
    remember("username", null);
  }

  function showWhoIsLoggedIn() {
    const inside = !!username;
    // A page with a data-waiting section shows it instead of data-logged-in
    // until the owner lets the member in.
    const waiting = inside && approved === false && all("[data-waiting]").length > 0;
    all("[data-logged-in]").forEach(el => el.hidden = !inside || waiting);
    all("[data-waiting]").forEach(el => el.hidden = !waiting);
    all("[data-logged-out]").forEach(el => el.hidden = inside);
    all("[data-username]").forEach(el => el.textContent = username || "");
    watchForApproval(waiting);
    // Logged out always starts on log in, not on whichever form was used last.
    if (!inside && all("form[data-login]").length) {
      all("form[data-login]").forEach(form => form.hidden = false);
      all("form[data-signup]").forEach(form => form.hidden = true);
    }
    all("[data-message]").forEach(el => say("", "", null, el));
    if (inside && approved === false && !waiting) say(WAITING);
  }

  // While a member is waiting, check every 20 seconds whether they have been
  // let in, and open the page up when they have.
  let approvalTimer = null;
  function watchForApproval(waiting) {
    if (!waiting) {
      clearInterval(approvalTimer);
      approvalTimer = null;
      return;
    }
    if (approvalTimer) return;
    approvalTimer = setInterval(async () => {
      const me = await ask(SITE_URL + "/me");
      if (!me.ok) return;
      if (!me.body.loggedIn) {
        forget();
      } else if (me.body.status === "approved") {
        approved = true;
      } else {
        return;
      }
      showWhoIsLoggedIn();
      refresh();
    }, 20000);
  }

  // Lists. The first item is copied once per thing. textContent stops typed
  // HTML from running.

  const lists = [];

  // data-list="scores" and data-insert="scores" name the collection. Pages made
  // before that used data-collection="scores", which still works.
  function collectionOf(el, attribute) {
    return el.getAttribute(attribute) || el.dataset.collection || undefined;
  }

  function setUpLists() {
    all("[data-list]").forEach(el => {
      const empty = el.querySelector(":scope > [data-empty]");
      const example = Array.from(el.children).find(child => !child.hasAttribute("data-empty"));
      if (!example) {
        return console.warn("A data-list needs an example inside it to copy.", el);
      }
      example.remove();
      if (empty) empty.hidden = true;
      lists.push({ el, example, empty, collection: collectionOf(el, "data-list"), items: [], turn: 0 });
    });
  }

  function fill(list, things) {
    list.items.forEach(item => item.remove());

    list.items = things.map(thing => {
      const item = list.example.cloneNode(true);

      const spots = Array.from(item.querySelectorAll("[data-field]"));
      if (item.hasAttribute("data-field")) spots.push(item);
      spots.forEach(spot => {
        const value = thing[spot.dataset.field];
        spot.textContent = value == null ? "" : value;
      });

      // Only show Delete and Update on your own things
      const mine = !!username && thing.by === username;
      item.querySelectorAll("[data-delete]").forEach(button => {
        button.hidden = !mine;
        button.onclick = () => del(thing, { from: button });
      });
      item.querySelectorAll("[data-update]").forEach(form => {
        form.hidden = !mine;
        fillForm(form, thing);
        form.onsubmit = e => {
          e.preventDefault();
          once(form, () => update(thing, readForm(form), { from: form }));
        };
      });

      list.el.insertBefore(item, list.empty || null);
      return item;
    });

    if (list.empty) list.empty.hidden = things.length > 0;
  }

  async function refresh() {
    await Promise.all(lists.map(async list => {
      const turn = ++list.turn;

      // Members-only list and nobody logged in
      if (!username && list.el.closest("[data-logged-in]")) return fill(list, []);

      const things = await load({
        collection: list.collection,
        sort:       list.el.dataset.sort,
        order:      list.el.dataset.order,
        limit:      list.el.dataset.limit,
        from:       list.el,
      });

      // Skip if a newer refresh started
      if (turn === list.turn) fill(list, things);
    }));
  }

  // Forms

  function readForm(form) {
    const thing = {};
    for (const input of form.elements) {
      if (!input.name || input.disabled || input.tagName === "BUTTON") continue;
      if (["submit", "button", "reset"].includes(input.type)) continue;

      if (input.type === "checkbox") {
        thing[input.name] = input.checked;
      } else if (input.type === "radio") {
        if (input.checked) thing[input.name] = input.value;
      } else if (input.type === "number" || input.type === "range") {
        if (input.value !== "") thing[input.name] = Number(input.value);
      } else {
        thing[input.name] = input.value.trim();
      }
    }
    return thing;
  }

  // Start a data-update form off with the thing's current values
  function fillForm(form, thing) {
    for (const input of form.elements) {
      if (!input.name || !(input.name in thing)) continue;
      if (input.type === "checkbox") input.checked = !!thing[input.name];
      else if (input.type === "radio") input.checked = String(thing[input.name]) === input.value;
      else if (input.tagName !== "BUTTON" && !["submit", "button", "reset"].includes(input.type)) {
        input.value = thing[input.name];
      }
    }
  }

  const busy = new WeakSet();

  // Stop double clicks saving twice
  async function once(form, job) {
    if (busy.has(form)) return;
    busy.add(form);
    try { await job(); } finally { busy.delete(form); }
  }

  document.addEventListener("submit", e => {
    const form = e.target;
    if (form.matches("[data-login]")) {
      e.preventDefault();
      once(form, () => logIn(form, false));
    } else if (form.matches("form[data-signup]")) {
      e.preventDefault();
      once(form, () => logIn(form, true));
    } else if (form.matches("[data-insert]")) {
      e.preventDefault();
      once(form, async () => {
        if (await insert(readForm(form), { collection: collectionOf(form, "data-insert"), from: form })) clear(form);
      });
    }
  });

  document.addEventListener("click", e => {
    // data-switch swaps the log in and sign up forms.
    if (e.target.closest("[data-switch]")) {
      e.preventDefault();
      all("form[data-login], form[data-signup]").forEach(form => form.hidden = !form.hidden);
      all("[data-message]").forEach(el => say("", "", null, el));
      return;
    }

    // A sign up button inside a log in form, for pages that use one form for both.
    const signup = e.target.closest("button[data-signup]");
    if (signup) {
      e.preventDefault();
      const form = signup.closest("form");
      if (form.reportValidity()) once(form, () => logIn(form, true));
    }
    if (e.target.closest("[data-logout]")) {
      e.preventDefault();
      logOut();
    }
  });

  // Messages go in the nearest data-message

  function say(text, kind, from, box) {
    box = box || nearestMessageBox(from);
    if (!box) {
      if (text) console.log(text);
      return;
    }
    box.textContent = text;
    box.classList.toggle("ok", kind === "ok");
    box.classList.toggle("bad", kind === "bad");
  }

  function nearestMessageBox(from) {
    for (let el = from; el; el = el.parentElement) {
      const box = all("[data-message]", el).find(isShowing);
      if (box) return box;
    }
    return all("[data-message]").find(isShowing) || null;
  }

  // Small helpers

  function all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  // form.reset() breaks if an input is named "reset"
  function clear(form) {
    HTMLFormElement.prototype.reset.call(form);
  }

  function isShowing(el) {
    return el.getClientRects().length > 0;
  }

  // localStorage can be blocked
  function remember(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {
      return null;
    }
  }

  // Start

  async function start() {
    // Make hidden win over your CSS
    const style = document.createElement("style");
    style.textContent = "[hidden] { display: none !important; }";
    document.head.appendChild(style);

    all("[data-logged-in], [data-logged-out], [data-waiting]").forEach(el => el.hidden = true);
    setUpLists();

    if (session) {
      // Check the login is still good
      const me = await ask(SITE_URL + "/me");
      if (me.ok && me.body.loggedIn) {
        username = me.body.username;
        approved = me.body.status === "approved";
      } else if (!me.offline) {
        forget();
      }
    }

    showWhoIsLoggedIn();
    refresh();
  }

  window.db = {
    insert:  (thing, options) => insert(thing, { collection: (options || {}).collection }),
    load:    options => load({ ...options, from: null }),
    update:  (thing, changes, options) => update(thing, changes, { collection: (options || {}).collection }),
    delete:  (thing, options) => del(thing, { collection: (options || {}).collection }),
    refresh,
    user:    () => username,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

