var config = require('../config');
var https = require('https');
var jwt = require('jsonwebtoken');
var http = require('../http/http');

const v4baseurl = 'https://api.github.com/graphql';

// data expected to be an object. will be stringified.
// defaults to github api v4.
const request = async ({ method = 'POST', data, headers = {}, url = v4baseurl } = {}) => {
    console.assert(config.secrets.githubToken, 'Must have a github token.');

    body = method !== 'GET' && typeof data !== 'undefined' && JSON.stringify(data);
    const options = {
        method,
        headers: {
            Authorization: `token ${config.secrets.githubToken}`,
            // if github breaks on us, rip. we'll deal with it then.
            Accept: 'application/vnd.github.merge-info-preview+json',
            // vnd.github.merge-info-preview
            // vnd.github.antiope-preview
            'Content-Type': 'application/json',
            'User-Agent': 'bot',
            ...headers,
        },
        url,
        body,
        ...(method === 'GET' && data ? { query: data } : {}),
    };

    const resp = await http.request(options);

    const respBody = JSON.parse(resp.body);
    // graphql api returns errros sometimes
    if (respBody.errors) {
        console.log(respBody.errors);
        throw new Error({ error: respBody.errors });
    }

    return { status: resp.status, body: respBody };
};

const v3baseurl = 'https://api.github.com';
// default to get, allow overrides
const v3request = async ({ uri, method = 'GET', headers, ...rest }) => {
    return await request({
        url: v3baseurl + uri,
        method,
        headers: {
            // required to get v3 of the api. hmmm.
            Accept: 'application/vnd.github.v3+json',
            ...headers,
        },
        ...rest,
    });
};

exports.v3request = v3request;

const query = query => request({ data: { query } });

exports.query = query;
exports.mutate = mutation => request({ data: { query: mutation } });

const appRequest = async ({ token, headers, method = 'GET', ...rest }, requestFn = request) => {
    console.assert(token);
    return requestFn({
        headers: {
            Accept: 'application/vnd.github.machine-man-preview+json',
            Authorization: `Bearer ${token}`,
            ...headers,
        },
        method,
        ...rest,
    });
};

const getJwt = env => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iat: now,
        // can we make it longer than 10min exp? do we care?
        exp: now + 10 * 60,
        iss: config.secrets.githubAppId,
    };

    return jwt.sign(payload, env.privateKey, { algorithm: 'RS256' });
};

const getFreshInstallationToken = async env => {
    const jwt = getJwt(env);

    const installations = await appRequest({ token: jwt, url: 'https://api.github.com/app/installations' });

    // TODO filter down based on config.
    const installationId = installations.body.first().id;

    // now get installation auth.
    const { body } = await appRequest({
        token: jwt,
        url: `https://api.github.com/app/installations/${installationId}/access_tokens`,
        method: 'POST',
    });
    return {
        token: body.token,
        // just set our expiry 5s before actual expiry to avoid
        // chances of failing this check.
        expiresAt: new Date(body.expires_at).getTime() - 5000,
    };
};

exports.getAppClient = async env => {
    let token = await getFreshInstallationToken(env);

    const maybeRefreshToken = async () => {
        if (token.expiresAt <= Date.now()) {
            token = await getFreshInstallationToken(env);
        }
    };

    const req = async (args = {}, requestFn = request) => {
        await maybeRefreshToken();
        return appRequest({ token: token.token, ...args }, requestFn);
    };

    return {
        request: async args => req(args),
        v3request: async args => req(args, v3request),
    };
};
