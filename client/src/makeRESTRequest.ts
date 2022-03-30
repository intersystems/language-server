import { workspace } from 'vscode';
import * as https from 'https';

import axios, { AxiosResponse } from 'axios';
import tough = require('tough-cookie');
import { wrapper } from 'axios-cookiejar-support';

import { client } from './extension';

/**
 * Cookie jar for REST requests to InterSystems servers.
 */
let cookieJar: tough.CookieJar = new tough.CookieJar();

wrapper(axios);

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
	if (api > server.apiVersion) {
		// The server doesn't support the Atelier API version required to make this request
		client.warn(`
			Cannot make required REST request to server 
			${server.serverName !== "" ? `'${server.serverName}'` : `${server.host}:${server.port}${server.pathPrefix}`} 
			because it does not support the '${path}' endpoint, which requires Atelier API version ${api}.
		`);
		return undefined;
	}
	if (!server.active) {
		// Server connection is inactive
		client.warn("Cannot make required REST request because the configured server connection is inactive.");
		return undefined;
	}

	// Build the URL
	let url = encodeURI(`${server.scheme}://${server.host}:${server.port}${server.pathPrefix}/api/atelier/v${server.apiVersion}/${server.namespace}${path}`);

	// Create the https Agent, if required
	const httpsAgent: https.Agent | undefined = 
		server.scheme == "https" ? new https.Agent({ rejectUnauthorized: workspace.getConfiguration("http").get("proxyStrictSSL") }) : undefined;

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
						"if-none-match": checksum
					},
					withCredentials: true,
					jar: cookieJar,
					validateStatus: function (status) {
						return status < 500;
					},
					httpsAgent: httpsAgent
				}
			);
			if (respdata.status === 202) {
				// The schema is being recalculated so we need to make another call to get it
				respdata = await axios.request(
					{
						method: "GET",
						url: url,
						withCredentials: true,
						jar: cookieJar,
						httpsAgent: httpsAgent
					},
				);
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
						jar: cookieJar,
						httpsAgent: httpsAgent
					}
				);
				if (respdata.status === 202) {
					// The schema is being recalculated so we need to make another call to get it
					respdata = await axios.request(
						{
							method: "GET",
							url: url,
							withCredentials: true,
							jar: cookieJar,
							httpsAgent: httpsAgent
						}
					);
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
							'Content-Type': 'application/json'
						},
						withCredentials: true,
						jar: cookieJar,
						validateStatus: function (status) {
							return status < 500;
						},
						httpsAgent: httpsAgent
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
							jar: cookieJar,
							httpsAgent: httpsAgent
						}
					);
				}
			}
			else {
				respdata = await axios.request(
					{
						method: method,
						url: url,
						withCredentials: true,
						jar: cookieJar,
						params: params,
						httpsAgent: httpsAgent
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
							jar: cookieJar,
							params: params,
							httpsAgent: httpsAgent
						}
					);
				}
			}
			return respdata;
		}
	} catch (error) {
		console.log(error);
		return undefined;
	}
};
