require('./monkeypatch/monkeypatch');
var poller = require('./poller/poller');
var setup = require('./setup/setup');

// check setup.
setup
    .setup()
    .then(env => {
        // start service.
        poller.fireloop(env);
    })
    .catch(err => console.log(err));
