var config = require('../config');
var http = require('../http/http');

const baseurl = 'https://api.buildkite.com/v2';

const request = async ({ uri, url }) => {
    console.assert(uri || url, 'need to pass in some location to query');
    // TODO try catch? handle errors somehow?
    const { status, body } = await http.request({
        method: 'GET',
        headers: {
            Authorization: `Bearer ${config.secrets.buildkiteToken}`,
        },
        url: url || `${baseurl}${uri}`,
    });

    return { status, body: JSON.parse(body) };
};

exports.request = request;
