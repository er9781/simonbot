var config = require('../config');
var http = require('../http/http');

const baseurl = 'https://api.buildkite.com/v2';

const request = async ({ uri, url, query, method = 'GET', jsonResponse = true }) => {
    console.assert(uri || url, 'need to pass in some location to query');
    // TODO try catch? handle errors somehow?
    const { status, body } = await http.request({
        method,
        headers: {
            Authorization: `Bearer ${config.secrets.buildkiteToken}`,
        },
        url: url || `${baseurl}${uri}`,
        query,
    });

    return { status, body: jsonResponse ? JSON.parse(body) : body };
};

exports.request = request;

exports.rawRequest = async args => request({ jsonResponse: false, ...args });
