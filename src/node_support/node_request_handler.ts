/*
 * Copyright 2017 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the
 * License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as EventEmitter from 'events';
import * as Http from 'http';
import * as Url from 'url';
import {AuthorizationRequest} from '../authorization_request';
import {AuthorizationRequestHandler, AuthorizationRequestResponse} from '../authorization_request_handler';
import {AuthorizationError, AuthorizationResponse} from '../authorization_response';
import {AuthorizationServiceConfiguration} from '../authorization_service_configuration';
import {Crypto} from '../crypto_utils';
import {log} from '../logger';
import {BasicQueryStringUtils, QueryStringUtils} from '../query_string_utils';
import {NodeCrypto} from './crypto_utils';


// TypeScript typings for `opener` are not correct and do not export it as module
import opener = require('opener');

export class NodeBasedHandler extends AuthorizationRequestHandler {
  // the handle to the current authorization request
  authorizationPromise: Promise<AuthorizationRequestResponse|null>|null = null;

  constructor(
      utils: QueryStringUtils = new BasicQueryStringUtils(),
      crypto: Crypto = new NodeCrypto()) {
    super(utils, crypto);
  }

  performAuthorizationRequest(
      configuration: AuthorizationServiceConfiguration,
      request: AuthorizationRequest) {
    // use opener to launch a web browser and start the authorization flow.
    // start a web server to handle the authorization response.

    const requestHandler = (httpRequest: Http.IncomingMessage, response: Http.ServerResponse) => {
      if (!httpRequest.url) {
        return;
      }

      const url = Url.parse(httpRequest.url);
      const searchParams = new Url.URLSearchParams(url.query || '');

      const state = searchParams.get('state') || undefined;
      const code = searchParams.get('code') || searchParams.get('approvalCode');
      const error = searchParams.get('error');

      if (!state && !code && !error) {
        // ignore irrelevant requests (e.g. favicon.ico)
        return;
      }

      log('Handling Authorization Request ', searchParams, state, code, error);
      let authorizationResponse: AuthorizationResponse|null = null;
      let authorizationError: AuthorizationError|null = null;
      if (error) {
        log('error');
        // get additional optional info.
        const errorUri = searchParams.get('error_uri') || undefined;
        const errorDescription = searchParams.get('error_description') || undefined;
        authorizationError = new AuthorizationError(
            {error: error, error_description: errorDescription, error_uri: errorUri, state: state});
      } else {
        authorizationResponse = new AuthorizationResponse({code: code!, state: state!});
      }
      const completeResponse = {
        request,
        response: authorizationResponse,
        error: authorizationError
      } as AuthorizationRequestResponse;
    };

    this.authorizationPromise = new Promise<AuthorizationRequestResponse>((resolve, reject) => {
    });

    request.setupCodeVerifier()
        .then(() => {
          const url = this.buildRequestUrl(configuration, request);
          log('Making a request to ', request, url);
          opener(url);
        })
        .catch((error) => {
          log('Something bad happened ', error);
        });
  }

  protected completeAuthorizationRequest(): Promise<AuthorizationRequestResponse|null> {
    if (!this.authorizationPromise) {
      return Promise.reject(
          'No pending authorization request. Call performAuthorizationRequest() ?');
    }

    return this.authorizationPromise;
  }
}
