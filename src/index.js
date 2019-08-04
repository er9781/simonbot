require('./monkeypatch/monkeypatch');
var poller = require('./poller/poller');
var check = require('./setup/check');

// check setup.
check.check();

// start service.
poller.fireloop();
