function savePreference(sender, value, reload = true, button = null) {
    return new Promise(function (resolve, reject) {
        if (button) button.classList.add('is-loading');
        var xhr = new XMLHttpRequest();
        xhr.responseType = 'json';
        xhr.open('POST', '/savepref', true);
        xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
        xhr.timeout = 60000;
        xhr.onload = () => {
            if (button) button.classList.remove('is-loading');
            if (reload) location.reload();
            if (xhr.status === 200)
                resolve(xhr.response);
            else
                reject(xhr.response)
        };
        xhr.onerror = () => {
            if (button) button.classList.remove('is-loading');
            reject({
                status: 'Error',
                msg: 'Error not specified'
            })
        };
        xhr.ontimeout = () => {
            if (button) button.classList.remove('is-loading');
            reject({
                status: 'Error',
                msg: 'Timeout (over 1 minute)'
            })
        };
        xhr.send(sender + "=" + value);
    });
}