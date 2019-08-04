require('./monkeypatch/monkeypatch');
var poller = require('./poller/poller');
var check = require('./setup/check');

// check setup.
check
    .check()
    .then(() => {
        // start service.
        poller.fireloop();
    })
    .catch(err => console.log(err));
