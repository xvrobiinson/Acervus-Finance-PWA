// Hands a Google sign-in to the desktop app (see desktop-sign-in.html).
// Only to 127.0.0.1, on the port the app gave, with the app's own check
// value, so the token can't be sent anywhere else.
(() => {
  const q = new URLSearchParams(location.search);
  const es = (navigator.language || "").toLowerCase().startsWith("es");
  const say = (title, text, bad) => {
    document.documentElement.lang = es ? "es" : "en";
    document.getElementById("title").textContent = title;
    document.getElementById("text").textContent = text;
    if (bad) document.getElementById("box").className = "bad";
  };
  const port = q.get("port") || "";
  const state = q.get("state") || "";
  const ott = q.get("ott") || "";
  const error = q.get("error") || "";
  // Keep the token out of the history and the address bar.
  history.replaceState(null, "", location.pathname);
  if (!/^\d{4,5}$/.test(port) || Number(port) > 65535 || !/^[A-Za-z0-9]{32,64}$/.test(state)) {
    say(es ? "Este enlace no es válido" : "This link isn't valid", es ? "Vuelve a la aplicación de escritorio e inténtalo de nuevo." : "Go back to the desktop app and try again.", true);
    return;
  }
  const back = new URL(`http://127.0.0.1:${port}/done`);
  back.searchParams.set("state", state);
  // Linking Google to an account that's already signed in (Drive backups)
  // returns no token: the app already has its session.
  const linking = q.get("mode") === "link";
  if (error) back.searchParams.set("error", error.slice(0, 64));
  else if (linking) back.searchParams.set("linked", "1");
  else if (ott && /^[A-Za-z0-9_-]{8,128}$/.test(ott)) back.searchParams.set("ott", ott);
  else back.searchParams.set("error", "no_token");
  say(es ? "Volviendo a la aplicación…" : "Going back to the app…", es ? "Si no pasa nada, vuelve a Acervus Finance en tu PC." : "If nothing happens, go back to Acervus Finance on your PC.");
  location.replace(back.toString());
})();
