// ViewController.swift calls this once Safari has said whether the extension
// is switched on. Until then the page shows its neutral text.
function show(enabled) {
    document.body.classList.toggle("state-on", enabled);
    document.body.classList.toggle("state-off", !enabled);
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);
