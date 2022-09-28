import { workspace } from 'vscode';

import axios, { AxiosResponse } from 'axios';
import * as https from 'https';

import { client, cookiesCache } from './extension';

export type ServerSpec = {
	scheme: string,
	host: string,
	port: number,
	pathPrefix: string,
	apiVersion: number,
	namespace: string,
	username: string,
	serverName: string,
	password: string,
	active: boolean
};

async function updateCookies(newCookies: string[], server: ServerSpec): Promise<string[]> {
	const key = `${server.username}@${server.host}:${server.port}${server.pathPrefix}`;
	const cookies = cookiesCache.get(key, []);
    newCookies.forEach((cookie) => {
      const [cookieName] = cookie.split("=");
      const index = cookies.findIndex((el) => el.startsWith(cookieName));
      if (index >= 0) {
        cookies[index] = cookie;
      } else {
        cookies.push(cookie);
      }
    });
    await cookiesCache.put(key, cookies);
	return cookies;
}

function getCookies(server: ServerSpec): string[] {
	return cookiesCache.get(`${server.username}@${server.host}:${server.port}${server.pathPrefix}`, []);
}

/**
 * Send a REST request to an InterSystems server.
 * 
 * @param method The REST method.
 * @param api The version of the Atelier API required for this request.
 * @param path The path portion of the URL.
 * @param server The server to send the request to.
 * @param data Optional request data. Usually passed for POST requests.
 * @param checksum Optional checksum. Only passed for SASchema requests.
 * @param params Optional URL parameters. Only passed for GET /doc/ requests.
 */
export async function makeRESTRequest(method: "GET"|"POST", api: number, path: string, server: ServerSpec, data?: any, checksum?: string, params?: any): Promise<AxiosResponse<any> | undefined> {
	if (server.host === "") {
		// No server connection is configured
		client.warn("Cannot make required REST request because no server connection is configured.");
		return undefined;
	}
	if (!server.active) {
		// Server connection is inactive
		client.warn("Cannot make required REST request because the configured server connection is inactive.");
		return undefined;
	}
	if (api > server.apiVersion) {
		// The server doesn't support the Atelier API version required to make this request
		client.warn(
			"Cannot make required REST request to server " +
			`${server.serverName !== "" ? `'${server.serverName}'` : `${server.host}:${server.port}${server.pathPrefix}`} ` +
			`because it does not support the '${path}' endpoint, which requires Atelier API version ${api}.`
		);
		return undefined;
	}
	if (server.username != undefined && server.username != "" && typeof server.password === "undefined") {
		// A username without a password isn't allowed
		client.warn("Cannot make required REST request because the configured server connection has a username but no password.");
		return undefined;
	}

	// Build the URL
	let url = encodeURI(`${server.scheme}://${server.host}:${server.port}${server.pathPrefix}/api/atelier/v${server.apiVersion}/${server.namespace}${path}`);

	// Create the HTTPS agent
	const httpsAgent = new https.Agent({ rejectUnauthorized: workspace.getConfiguration("http").get("proxyStrictSSL") });

	// Get the cookies
	let cookies: string[] = getCookies(server);

	// Make the request
	try {
		if (checksum !== undefined) {
			// This is a SASchema request
			
			// Make the initial request
			var respdata: AxiosResponse;
			respdata = await axios.request(
				{
					method: "GET",
					url: url,
					headers: {
						"if-none-match": checksum,
						"Cookie": cookies.join(" ")
					},
					withCredentials: true,
  					httpsAgent,
					validateStatus: function (status) {
						return status < 500;
					}
				}
			);
			cookies = await updateCookies(respdata.headers['set-cookie'] || [], server);
			if (respdata.status === 202) {
				// The schema is being recalculated so we need to make another call to get it
				respdata = await axios.request(
					{
						method: "GET",
						url: url,
						withCredentials: true,
  						httpsAgent,
						headers: {
							"Cookie": cookies.join(" ")
						}
					},
				);
				await updateCookies(respdata.headers['set-cookie'] || [], server);
				return respdata;
			}
			else if (respdata.status === 304) {
				// The schema hasn't changed
				return undefined;
			}
			else if (respdata.status === 401) {
				// Either we had no cookies or they expired, so resend the request with basic auth

				respdata = await axios.request(
					{
						method: "GET",
						url: url,
						headers: {
							"if-none-match": checksum
						},
						auth: {
							username: server.username,
							password: server.password
						},
						withCredentials: true,
  						httpsAgent
					}
				);
				cookies = await updateCookies(respdata.headers['set-cookie'] || [], server);
				if (respdata.status === 202) {
					// The schema is being recalculated so we need to make another call to get it
					respdata = await axios.request(
						{
							method: "GET",
							url: url,
							withCredentials: true,
  							httpsAgent,
							headers: {
								"Cookie": cookies.join(" ")
							}
						}
					);
					await updateCookies(respdata.headers['set-cookie'] || [], server);
					return respdata;
				}
				else if (respdata.status === 304) {
					// The schema hasn't changed
					return undefined;
				}
				else {
					// We got the schema
					return respdata;
				}
			}
			else {
				// We got the schema
				return respdata;
			}
		}
		else {
			// This is a different request
	
			var respdata: AxiosResponse;
			if (data !== undefined) {
				respdata = await axios.request(
					{
						method: method,
						url: url,
						data: data,
						headers: {
							'Content-Type': 'application/json',
							"Cookie": cookies.join(" ")
						},
						withCredentials: true,
  						httpsAgent,
						validateStatus: function (status) {
							return status < 500;
						}
					}
				);
				if (respdata.status === 401) {
					// Either we had no cookies or they expired, so resend the request with basic auth

					respdata = await axios.request(
						{
							method: method,
							url: url,
							data: data,
							headers: {
								'Content-Type': 'application/json'
							},
							auth: {
								username: server.username,
								password: server.password
							},
							withCredentials: true,
  							httpsAgent
						}
					);
				}
				await updateCookies(respdata.headers['set-cookie'] || [], server);
			}
			else {
				respdata = await axios.request(
					{
						method: method,
						url: url,
						withCredentials: true,
  						httpsAgent,
						params: params,
						headers: {
							"Cookie": cookies.join(" ")
						},
						validateStatus: function (status) {
							return status < 500;
						}
					}
				);
				if (respdata.status === 401) {
					// Either we had no cookies or they expired, so resend the request with basic auth

					respdata = await axios.request(
						{
							method: method,
							url: url,
							auth: {
								username: server.username,
								password: server.password
							},
							withCredentials: true,
  							httpsAgent,
							params: params
						}
					);
				}
				await updateCookies(respdata.headers['set-cookie'] || [], server);
			}
			return respdata;
		}
	} catch (error) {
		console.log(error);
		return undefined;
	}
};
