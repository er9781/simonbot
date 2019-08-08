var https = require('https');
var querystring = require('querystring');

exports.request = async ({ method = 'POST', body, headers = {}, url, query } = {}) => {
    console.assert(['GET', 'POST'].includes(method));
    console.assert(url, 'must have a url');

    const qs = query && querystring.stringify(query);
    const fullUrl = url + (qs ? `?${qs}` : '');

    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'bot',
            ...headers,
        },
        ...(body ? { 'Content-Length': body.length } : {}),
    };

    return new Promise((resolve, reject) => {
        const req = https.request(fullUrl, options, resp => {
            console.log('hello', fullUrl, resp.statusCode, typeof resp.statusCode);
            // fail on 4xx or 5xx codes. maybe consider more granular errors. Could retry on 5xx but not on 4xx for instance.
            if (resp.statusCode >= 400) {
                console.log(method);
                console.log(resp);
                reject({
                    status: resp.statusCode,
                    message: resp.statusMessage,
                });
            }

            // TODO do we want automatic retries?

            let respBody = '';
            resp.on('data', data => {
                respBody += data;
            });

            resp.on('end', () => {
                // success yay. let's return status + body.
                resolve({ status: resp.statusCode, body: respBody });
            });
        });

        req.on('error', err => {
            reject({ error: 'request failed' });
        });

        if (method === 'POST' && body) {
            req.write(body);
        }
        req.end();
    });
};
