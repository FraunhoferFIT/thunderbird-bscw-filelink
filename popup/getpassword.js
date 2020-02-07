const form = document.querySelector("form");
const passwordInputField = form.password;
const introText = form.querySelector("#passwordIntroText");
const submitButton = form.querySelector("#submit");
const cancelButton = form.querySelector("#cancel");

const searchParams = new URL(location.href).searchParams;
const username = searchParams.get("username");
const url = searchParams.get("url");

// TODO how to detect window closed reliably and send a message (empty password)?

/**
 * @param {string} password
 */
function sendPasswordViaMessage(password) {
    return browser.runtime.sendMessage({
        msgtype: MSGTYPE_PASSWORD_POPUP_RESPONSE,
        password: password
    });
}

(() => {
    // Apply internationalization of the dialog elements.
    // Do this in an anonymous function (which we call immediately) to properly scope local variables
    for (let element of document.querySelectorAll("[data-message]")) {
        element.innerHTML = browser.i18n.getMessage(element.dataset.message);
    }

    // Parametrized(!) internationalization has to be done separately:
    introText.innerHTML = browser.i18n.getMessage("passwordIntroText", [url, username]);

    // Handle enter key press
    form.onsubmit = handleSubmit;

    // This *should* capture when the user closes the window - but there are TB bugs all over the place:
    /*
    1. onbeforeunload never triggers, for no good reason
    2. unload does trigger, but then sending a message (sendPasswordViaMessage()) doesn't seem to really do anything
    Consequently, I am out of options regarding how to let the rest of the code know that the window was closed...
     */
    /*
    window.addEventListener('unload', async function (e) {
        console.log("unload"); // sanity check
        //alert("onbeforeunload");
        await sendPasswordViaMessage("");

        console.log("msg sent");
    });
    */
})();

function handleSubmit(e) {
    sendPasswordViaMessage(passwordInputField.value);
    // this avoids that TB tries to open the popup page as URL (shows a dialog that asks the user which
    // program is most suited, hehehe)
    e.preventDefault();
    // window.onunload = null;
    // window.close(); doesn't do shit
}

submitButton.onclick = handleSubmit;

cancelButton.onclick = async function () {
    sendPasswordViaMessage("");
    // window.onunload = null;
    // window.close(); doesn't do shit
};
