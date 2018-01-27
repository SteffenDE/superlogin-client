var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

import axios from "axios";
import _debug from "debug";
import { EventEmitter2 } from "eventemitter2";
import URL from "url-parse";
require("babel-polyfill");

var debug = {
  log: _debug("superlogin:log"),
  info: _debug("superlogin:info"),
  warn: _debug("superlogin:warn"),
  error: _debug("superlogin:error")
};

// Capitalizes the first letter of a string
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function parseHostFromUrl(url) {
  var parsedURL = new URL(url);
  return parsedURL.host;
}

function checkEndpoint(url, endpoints) {
  var host = parseHostFromUrl(url);
  return !!~endpoints.indexOf(host);
}
function isStorageAvailable() {
  var mod = "__STORAGE__";
  try {
    localStorage.setItem(mod, mod);
    localStorage.removeItem(mod);
    return true;
  } catch (e) {
    return false;
  }
}

function parseError(err) {
  // if no connection can be established we don't have any data thus we need to forward the original error.
  if (err && err.response && err.response.data) {
    return err.response.data;
  }
  return err;
}

var memoryStorage = {
  setItem: function setItem(key, value) {
    memoryStorage.storage.set(key, value);
  },
  getItem: function getItem(key) {
    var value = memoryStorage.storage.get(key);
    if (typeof value !== "undefined") {
      return value;
    }
    return null;
  },
  removeItem: function removeItem(key) {
    memoryStorage.storage.delete(key);
  },
  storage: new Map()
};

var Superlogin = function (_EventEmitter) {
  _inherits(Superlogin, _EventEmitter);

  function Superlogin() {
    _classCallCheck(this, Superlogin);

    var _this = _possibleConstructorReturn(this, (Superlogin.__proto__ || Object.getPrototypeOf(Superlogin)).call(this));

    _this._oauthComplete = false;
    _this._config = {};
    _this._refreshInProgress = false;
    _this._http = axios.create();
    return _this;
  }

  _createClass(Superlogin, [{
    key: "configure",
    value: function configure() {
      var _this2 = this;

      var config = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      if (config.serverUrl) {
        this._http = axios.create({
          baseURL: config.serverUrl,
          timeout: config.timeout
        });
      }

      config.baseUrl = config.baseUrl || "/auth";
      config.baseUrl = config.baseUrl.replace(/\/$/, ""); // remove trailing /
      config.socialUrl = config.socialUrl || config.baseUrl;
      config.socialUrl = config.socialUrl.replace(/\/$/, ""); // remove trailing /
      config.local = config.local || {};
      config.local.usernameField = config.local.usernameField || "username";
      config.local.passwordField = config.local.passwordField || "password";

      if (!config.endpoints || !(config.endpoints instanceof Array)) {
        config.endpoints = [];
      }
      if (!config.noDefaultEndpoint) {
        var defaultEndpoint = window.location.host;
        if (config.serverUrl) {
          defaultEndpoint = parseHostFromUrl(config.serverUrl);
        }
        if (!~config.endpoints.indexOf(defaultEndpoint)) {
          config.endpoints.push(defaultEndpoint);
        }
      }
      config.providers = config.providers || [];
      config.timeout = config.timeout || 0;

      if (!isStorageAvailable()) {
        this.storage = memoryStorage;
      } else if (config.storage === "session") {
        this.storage = window.sessionStorage;
      } else {
        this.storage = window.localStorage;
      }

      this._config = config;

      // Setup the new session
      this._session = JSON.parse(this.storage.getItem("superlogin.session"));

      this._httpInterceptor();

      // Check expired
      if (config.checkExpired) {
        this.checkExpired();
        this.validateSession().then(function () {
          _this2._onLogin(_this2._session);
        }).catch(function () {
          // ignoring
        });
      }
    }
  }, {
    key: "_httpInterceptor",
    value: function _httpInterceptor() {
      var _this3 = this;

      var request = function request(req) {
        var config = _this3.getConfig();
        var session = _this3.getSession();
        if (!session || !session.token) {
          return Promise.resolve(req);
        }

        if (req.skipRefresh) {
          return Promise.resolve(req);
        }

        return _this3.checkRefresh().then(function () {
          if (checkEndpoint(new URL(req.url, req.baseURL), config.endpoints)) {
            if (!req.headers.Authorization) {
              req.headers.Authorization = "Bearer " + session.token;
            }
          }
          return req;
        });
      };

      var responseError = function responseError(error) {
        var config = _this3.getConfig();

        // if there is not config obj in in the error it means we cannot check the endpoints.
        // This happens for example if there is no connection at all because axion just forwards the raw error.
        if (!error || !error.config) {
          return Promise.reject(error);
        }

        // If there is an unauthorized error from one of our endpoints and we are logged in...
        if (checkEndpoint(error.config.url, config.endpoints) && error.response && error.response.status === 401 && _this3.authenticated()) {
          debug.warn("Not authorized");
          _this3._onLogout("Session expired");
        }
        return Promise.reject(error);
      };
      // clear interceptors from a previous configure call
      this._http.interceptors.request.eject(this._httpRequestInterceptor);
      this._http.interceptors.response.eject(this._httpResponseInterceptor);

      this._httpRequestInterceptor = this._http.interceptors.request.use(request.bind(this));
      this._httpResponseInterceptor = this._http.interceptors.response.use(null, responseError.bind(this));
    }
  }, {
    key: "authenticated",
    value: function authenticated() {
      return !!(this._session && this._session.user_id);
    }
  }, {
    key: "getConfig",
    value: function getConfig() {
      return this._config;
    }
  }, {
    key: "validateSession",
    value: function () {
      var _ref = _asyncToGenerator(regeneratorRuntime.mark(function _callee() {
        return regeneratorRuntime.wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                if (this.authenticated()) {
                  _context.next = 2;
                  break;
                }

                throw new Error("User is not authenticated");

              case 2:
                if (!(this._session.expires > Date.now())) {
                  _context.next = 6;
                  break;
                }

                return _context.abrupt("return", true);

              case 6:
                _context.prev = 6;
                _context.next = 9;
                return this.refresh();

              case 9:
                _context.next = 15;
                break;

              case 11:
                _context.prev = 11;
                _context.t0 = _context["catch"](6);

                this._onLogout("Session expired");
                throw parseError(_context.t0);

              case 15:
              case "end":
                return _context.stop();
            }
          }
        }, _callee, this, [[6, 11]]);
      }));

      function validateSession() {
        return _ref.apply(this, arguments);
      }

      return validateSession;
    }()
  }, {
    key: "getSession",
    value: function getSession() {
      if (!this._session) {
        this._session = JSON.parse(this.storage.getItem("superlogin.session"));
      }
      if (this._session && !this._session.refreshToken) {
        this._session.refreshToken = this.storage.getItem("superlogin.refreshToken");
      }
      return this._session ? Object.assign(this._session) : null;
    }
  }, {
    key: "setSession",
    value: function setSession(session) {
      this._session = session;
      if (this._session.refreshToken) {
        this.storage.setItem("superlogin.refreshToken", this._session.refreshToken);
      }
      this.storage.setItem("superlogin.session", JSON.stringify(this._session));
      debug.info("New session set");
    }
  }, {
    key: "deleteSession",
    value: function deleteSession() {
      this.storage.removeItem("superlogin.session");
      this.storage.removeItem("superlogin.refreshToken");
      this._session = null;
    }
  }, {
    key: "getDbUrl",
    value: function getDbUrl(dbName) {
      if (this._session.userDBs && this._session.userDBs[dbName]) {
        return this._session.userDBs[dbName];
      }
      return null;
    }
  }, {
    key: "getHttp",
    value: function getHttp() {
      return this._http;
    }
  }, {
    key: "confirmRole",
    value: function confirmRole(role) {
      if (!this._session || !this._session.roles || !this._session.roles.length) return false;
      return this._session.roles.indexOf(role) !== -1;
    }
  }, {
    key: "confirmAnyRole",
    value: function confirmAnyRole(roles) {
      if (!this._session || !this._session.roles || !this._session.roles.length) return false;
      for (var i = 0; i < roles.length; i += 1) {
        if (this._session.roles.indexOf(roles[i]) !== -1) return true;
      }
      return false;
    }
  }, {
    key: "confirmAllRoles",
    value: function confirmAllRoles(roles) {
      if (!this._session || !this._session.roles || !this._session.roles.length) return false;
      for (var i = 0; i < roles.length; i += 1) {
        if (this._session.roles.indexOf(roles[i]) === -1) return false;
      }
      return true;
    }
  }, {
    key: "checkRefresh",
    value: function checkRefresh() {
      // Get out if we are not authenticated or a refresh is already in progress
      if (this._refreshInProgress) {
        return Promise.resolve();
      }
      if (!this._session || !this._session.user_id) {
        return Promise.reject(new Error({ "error": "User is not authenticated" }));
      }
      // try getting the latest refresh date, if not available fall back to issued date
      var refreshed = this._session.refreshed || this._session.issued;
      var expires = this._session.expires;
      var threshold = isNaN(this._config.refreshThreshold) ? 0.5 : this._config.refreshThreshold;
      var duration = expires - refreshed;
      var timeDiff = this._session.serverTimeDiff || 0;
      if (Math.abs(timeDiff) < 5000) {
        timeDiff = 0;
      }
      var estimatedServerTime = Date.now() + timeDiff;
      var elapsed = estimatedServerTime - refreshed;
      var ratio = elapsed / duration;
      if (ratio > threshold) {
        debug.info("Refreshing session");
        return this.refresh().then(function (session) {
          debug.log("Refreshing session sucess", session);
          return session;
        }).catch(function (err) {
          debug.error("Refreshing session failed", err);
          throw err;
        });
      }
      return Promise.resolve();
    }
  }, {
    key: "checkExpired",
    value: function checkExpired() {
      var _this4 = this;

      // This is not necessary if we are not authenticated
      if (!this.authenticated()) {
        return;
      }
      var expires = this._session.expires;
      var timeDiff = this._session.serverTimeDiff || 0;
      // Only compensate for time difference if it is greater than 5 seconds
      if (Math.abs(timeDiff) < 5000) {
        timeDiff = 0;
      }
      var estimatedServerTime = Date.now() + timeDiff;
      if (estimatedServerTime > expires) {
        // try to refresh session using the refresh token
        this.refresh().catch(function () {
          _this4._onLogout("Session expired");
        });
      }
    }
  }, {
    key: "refresh",
    value: function () {
      var _ref2 = _asyncToGenerator(regeneratorRuntime.mark(function _callee2() {
        var session, options, res;
        return regeneratorRuntime.wrap(function _callee2$(_context2) {
          while (1) {
            switch (_context2.prev = _context2.next) {
              case 0:
                session = this.getSession();

                this._refreshInProgress = true;
                options = {};
                res = void 0;

                if (session.expires < Date.now() + 1000 * 60 && session.refreshToken) {
                  // access token is expired or nearly expired
                  // we'll have to use the refresh token
                  console.log("access token expired, using refresh token");
                  options["headers"] = {
                    Authorization: "Bearer " + session.refreshToken
                  };
                }
                _context2.prev = 5;
                _context2.next = 8;
                return this._http.post(this._config.baseUrl + "/refresh", {}, options);

              case 8:
                res = _context2.sent;
                _context2.next = 15;
                break;

              case 11:
                _context2.prev = 11;
                _context2.t0 = _context2["catch"](5);

                this._refreshInProgress = false;
                throw parseError(_context2.t0);

              case 15:
                this._refreshInProgress = false;
                if (res.data.token && res.data.expires) {
                  Object.assign(session, res.data);
                  this.setSession(session);
                  this._onRefresh(session);
                }
                return _context2.abrupt("return", session);

              case 18:
              case "end":
                return _context2.stop();
            }
          }
        }, _callee2, this, [[5, 11]]);
      }));

      function refresh() {
        return _ref2.apply(this, arguments);
      }

      return refresh;
    }()
  }, {
    key: "authenticate",
    value: function authenticate() {
      var _this5 = this;

      return new Promise(function (resolve) {
        var session = _this5.getSession();
        if (session) {
          resolve(session);
        } else {
          _this5.on("login", function (newSession) {
            resolve(newSession);
          });
        }
      });
    }
  }, {
    key: "login",
    value: function () {
      var _ref3 = _asyncToGenerator(regeneratorRuntime.mark(function _callee3(credentials) {
        var _config$local, usernameField, passwordField, res;

        return regeneratorRuntime.wrap(function _callee3$(_context3) {
          while (1) {
            switch (_context3.prev = _context3.next) {
              case 0:
                _config$local = this._config.local, usernameField = _config$local.usernameField, passwordField = _config$local.passwordField;

                if (!(!credentials[usernameField] || !credentials[passwordField])) {
                  _context3.next = 3;
                  break;
                }

                throw new Error("Username or Password missing...");

              case 3:
                res = void 0;
                _context3.prev = 4;
                _context3.next = 7;
                return this._http.post(this._config.baseUrl + "/login", credentials, {
                  skipRefresh: true
                });

              case 7:
                res = _context3.sent;
                _context3.next = 14;
                break;

              case 10:
                _context3.prev = 10;
                _context3.t0 = _context3["catch"](4);

                this.deleteSession();
                throw parseError(_context3.t0);

              case 14:
                res.data.serverTimeDiff = res.data.issued - Date.now();
                this.setSession(res.data);
                this._onLogin(res.data);
                return _context3.abrupt("return", res.data);

              case 18:
              case "end":
                return _context3.stop();
            }
          }
        }, _callee3, this, [[4, 10]]);
      }));

      function login(_x2) {
        return _ref3.apply(this, arguments);
      }

      return login;
    }()
  }, {
    key: "register",
    value: function () {
      var _ref4 = _asyncToGenerator(regeneratorRuntime.mark(function _callee4(registration) {
        var res;
        return regeneratorRuntime.wrap(function _callee4$(_context4) {
          while (1) {
            switch (_context4.prev = _context4.next) {
              case 0:
                res = void 0;
                _context4.prev = 1;
                _context4.next = 4;
                return this._http.post(this._config.baseUrl + "/register", registration, {
                  skipRefresh: true
                });

              case 4:
                res = _context4.sent;
                _context4.next = 10;
                break;

              case 7:
                _context4.prev = 7;
                _context4.t0 = _context4["catch"](1);
                throw parseError(_context4.t0);

              case 10:
                if (res.data.user_id && res.data.token) {
                  res.data.serverTimeDiff = res.data.issued - Date.now();
                  this.setSession(res.data);
                  this._onLogin(res.data);
                }
                this._onRegister(registration);
                return _context4.abrupt("return", res.data);

              case 13:
              case "end":
                return _context4.stop();
            }
          }
        }, _callee4, this, [[1, 7]]);
      }));

      function register(_x3) {
        return _ref4.apply(this, arguments);
      }

      return register;
    }()
  }, {
    key: "logout",
    value: function () {
      var _ref5 = _asyncToGenerator(regeneratorRuntime.mark(function _callee5(msg) {
        var session, res;
        return regeneratorRuntime.wrap(function _callee5$(_context5) {
          while (1) {
            switch (_context5.prev = _context5.next) {
              case 0:
                session = this.getSession();

                if (session.dbUser) {
                  _context5.next = 4;
                  break;
                }

                // We are only using JWTs, so the user has to delete the token locally
                this._onLogout(msg || "Logged out");
                return _context5.abrupt("return");

              case 4:
                res = void 0;
                _context5.prev = 5;
                _context5.next = 8;
                return this._http.post(this._config.baseUrl + "/logout", {});

              case 8:
                res = _context5.sent;
                _context5.next = 17;
                break;

              case 11:
                _context5.prev = 11;
                _context5.t0 = _context5["catch"](5);

                this._onLogout(msg || "Logged out");

                if (!(!_context5.t0.response || _context5.t0.response.data.status !== 401)) {
                  _context5.next = 16;
                  break;
                }

                throw parseError(_context5.t0);

              case 16:
                return _context5.abrupt("return");

              case 17:
                this._onLogout(msg || "Logged out");
                return _context5.abrupt("return", res.data);

              case 19:
              case "end":
                return _context5.stop();
            }
          }
        }, _callee5, this, [[5, 11]]);
      }));

      function logout(_x4) {
        return _ref5.apply(this, arguments);
      }

      return logout;
    }()
  }, {
    key: "logoutAll",
    value: function () {
      var _ref6 = _asyncToGenerator(regeneratorRuntime.mark(function _callee6(msg) {
        var session, res;
        return regeneratorRuntime.wrap(function _callee6$(_context6) {
          while (1) {
            switch (_context6.prev = _context6.next) {
              case 0:
                session = this.getSession();

                if (session.dbUser) {
                  _context6.next = 4;
                  break;
                }

                // We are only using JWTs, so the user has to delete the token locally
                this._onLogout(msg || "Logged out");
                return _context6.abrupt("return");

              case 4:
                res = void 0;
                _context6.prev = 5;
                _context6.next = 8;
                return this._http.post(this._config.baseUrl + "/logout-all", {});

              case 8:
                res = _context6.sent;
                _context6.next = 17;
                break;

              case 11:
                _context6.prev = 11;
                _context6.t0 = _context6["catch"](5);

                this._onLogout(msg || "Logged out");

                if (!(!_context6.t0.response || _context6.t0.response.data.status !== 401)) {
                  _context6.next = 16;
                  break;
                }

                throw parseError(_context6.t0);

              case 16:
                return _context6.abrupt("return");

              case 17:
                this._onLogout(msg || "Logged out");
                return _context6.abrupt("return", res.data);

              case 19:
              case "end":
                return _context6.stop();
            }
          }
        }, _callee6, this, [[5, 11]]);
      }));

      function logoutAll(_x5) {
        return _ref6.apply(this, arguments);
      }

      return logoutAll;
    }()
  }, {
    key: "logoutOthers",
    value: function logoutOthers() {
      return this._http.post(this._config.baseUrl + "/logout-others", {}).then(function (res) {
        return res.data;
      }).catch(function (err) {
        throw parseError(err);
      });
    }
  }, {
    key: "socialAuth",
    value: function socialAuth(provider) {
      var providers = this._config.providers;
      if (providers.indexOf(provider) === -1) {
        return Promise.reject(new Error({ error: "Provider " + provider + " not supported." }));
      }
      var url = this._config.socialUrl + "/" + provider;
      return this._oAuthPopup(url, { windowTitle: "Login with " + capitalizeFirstLetter(provider) });
    }
  }, {
    key: "tokenSocialAuth",
    value: function tokenSocialAuth(provider, accessToken) {
      var _this6 = this;

      var providers = this._config.providers;
      if (providers.indexOf(provider) === -1) {
        return Promise.reject(new Error({ error: "Provider " + provider + " not supported." }));
      }
      return this._http.post(this._config.baseUrl + "/" + provider + "/token", { access_token: accessToken }).then(function (res) {
        if (res.data.user_id && res.data.token) {
          res.data.serverTimeDiff = res.data.issued - Date.now();
          _this6.setSession(res.data);
          _this6._onLogin(res.data);
        }
        return res.data;
      }).catch(function (err) {
        throw parseError(err);
      });
    }
  }, {
    key: "tokenLink",
    value: function tokenLink(provider, accessToken) {
      var providers = this._config.providers;
      if (providers.indexOf(provider) === -1) {
        return Promise.reject(new Error({ error: "Provider " + provider + " not supported." }));
      }
      var linkURL = this._config.baseUrl + "/link/" + provider + "/token";
      return this._http.post(linkURL, { access_token: accessToken }).then(function (res) {
        return res.data;
      }).catch(function (err) {
        throw parseError(err);
      });
    }
  }, {
    key: "link",
    value: function link(provider) {
      var providers = this._config.providers;
      if (providers.indexOf(provider) === -1) {
        return Promise.reject(new Error({ error: "Provider " + provider + " not supported." }));
      }
      if (this.authenticated()) {
        var session = this.getSession();
        var token = "bearer_token=" + session.token + ":" + session.password;
        var linkURL = this._config.socialUrl + "/link/" + provider + "?" + token;
        var windowTitle = "Link your account to " + capitalizeFirstLetter(provider);
        return this._oAuthPopup(linkURL, { windowTitle: windowTitle });
      }
      return Promise.reject(new Error({ error: "Authentication required" }));
    }
  }, {
    key: "unlink",
    value: function unlink(provider) {
      var providers = this._config.providers;
      if (providers.indexOf(provider) === -1) {
        return Promise.reject(new Error({ error: "Provider " + provider + " not supported." }));
      }
      if (this.authenticated()) {
        return this._http.post(this._config.baseUrl + "/unlink/" + provider).then(function (res) {
          return res.data;
        }).catch(function (err) {
          throw parseError(err);
        });
      }
      return Promise.reject(new Error({ error: "Authentication required" }));
    }
  }, {
    key: "confirmEmail",
    value: function confirmEmail(token) {
      if (!token || typeof token !== "string") {
        return Promise.reject(new Error({ error: "Invalid token" }));
      }
      return this._http.get(this._config.baseUrl + "/confirm-email/" + token).then(function (res) {
        return res.data;
      }).catch(function (err) {
        throw parseError(err);
      });
    }
  }, {
    key: "forgotPassword",
    value: function forgotPassword(email) {
      return this._http.post(this._config.baseUrl + "/forgot-password", { email: email }, { skipRefresh: true }).then(function (res) {
        return res.data;
      }).catch(function (err) {
        throw parseError(err);
      });
    }
  }, {
    key: "resetPassword",
    value: function resetPassword(form) {
      var _this7 = this;

      return this._http.post(this._config.baseUrl + "/password-reset", form, { skipRefresh: true }).then(function (res) {
        if (res.data.user_id && res.data.token) {
          _this7.setSession(res.data);
          _this7._onLogin(res.data);
        }
        return res.data;
      }).catch(function (err) {
        throw parseError(err);
      });
    }
  }, {
    key: "changePassword",
    value: function changePassword(form) {
      if (this.authenticated()) {
        return this._http.post(this._config.baseUrl + "/password-change", form).then(function (res) {
          return res.data;
        }).catch(function (err) {
          throw parseError(err);
        });
      }
      return Promise.reject(new Error({ error: "Authentication required" }));
    }
  }, {
    key: "changeEmail",
    value: function changeEmail(newEmail) {
      if (this.authenticated()) {
        return this._http.post(this._config.baseUrl + "/change-email", { newEmail: newEmail }).then(function (res) {
          return res.data;
        }).catch(function (err) {
          throw parseError(err);
        });
      }
      return Promise.reject(new Error({ error: "Authentication required" }));
    }
  }, {
    key: "validateUsername",
    value: function validateUsername(username) {
      return this._http.get(this._config.baseUrl + "/validate-username/" + encodeURIComponent(username)).then(function () {
        return true;
      }).catch(function (err) {
        throw parseError(err);
      });
    }
  }, {
    key: "validateEmail",
    value: function validateEmail(email) {
      return this._http.get(this._config.baseUrl + "/validate-email/" + encodeURIComponent(email)).then(function () {
        return true;
      }).catch(function (err) {
        throw parseError(err);
      });
    }
  }, {
    key: "_oAuthPopup",
    value: function _oAuthPopup(url, options) {
      var _this8 = this;

      return new Promise(function (resolve, reject) {
        _this8._oauthComplete = false;
        options.windowName = options.windowTitle || "Social Login";
        options.windowOptions = options.windowOptions || "location=0,status=0,width=800,height=600";
        var _oauthWindow = window.open(url, options.windowName, options.windowOptions);

        if (!_oauthWindow) {
          reject(new Error({ error: "Authorization popup blocked" }));
        }

        var _oauthInterval = setInterval(function () {
          if (_oauthWindow.closed) {
            clearInterval(_oauthInterval);
            if (!_this8._oauthComplete) {
              _this8.authComplete = true;
              reject(new Error({ error: "Authorization cancelled" }));
            }
          }
        }, 500);

        window.superlogin = {};
        window.superlogin.oauthSession = function (error, session, link) {
          if (!error && session) {
            session.serverTimeDiff = session.issued - Date.now();
            _this8.setSession(session);
            _this8._onLogin(session);
            return resolve(session);
          } else if (!error && link) {
            _this8._onLink(link);
            return resolve(capitalizeFirstLetter(link) + " successfully linked.");
          }
          _this8._oauthComplete = true;
          return reject(error);
        };
      });
    }
  }, {
    key: "_onLogin",
    value: function _onLogin(msg) {
      debug.info("Login", msg);
      this.emit("login", msg);
    }
  }, {
    key: "_onLogout",
    value: function _onLogout(msg) {
      this.deleteSession();
      debug.info("Logout", msg);
      this.emit("logout", msg);
    }
  }, {
    key: "_onLink",
    value: function _onLink(msg) {
      debug.info("Link", msg);
      this.emit("link", msg);
    }
  }, {
    key: "_onRegister",
    value: function _onRegister(msg) {
      debug.info("Register", msg);
      this.emit("register", msg);
    }
  }, {
    key: "_onRefresh",
    value: function _onRefresh(msg) {
      debug.info("Refresh", msg);
      this.emit("refresh", msg);
    }
  }]);

  return Superlogin;
}(EventEmitter2);

export default new Superlogin();