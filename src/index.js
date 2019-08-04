require('./monkeypatch/monkeypatch');
var poller = require('./poller/poller');
var check = require('./setup/check');

// check setup.
check
    .check()
    .then(env => {
        // start service.
        poller.fireloop(env);
    })
    .catch(err => console.log(err));
