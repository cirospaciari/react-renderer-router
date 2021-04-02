"use strict";

const RenderService = require('./renderService');

const path = require('path');

require('ignore-styles');

class Router {
  constructor(options) {
    this.routes_file = options.routes;
    this.html_file = options.html_file;
    this.renderer = new RenderService(options.instances || 2, options.use_fork ? 'fork' : 'thread');
    this.max_memory = options.max_memory || 250;
    this.routes = [];
    this.babel_config = options.babel_config || path.join(__dirname, './babelConfig.js');
    this.remove_images = typeof options.remove_images === "undefined" ? true : !!options.remove_images;
    this.assets = options.assets || {};
    this.assets.img_path = this.assets.img_path || '/static/media';
    this.assets.css_path = this.assets.css_path || '/static/css';
    this.root_element = options.root_element || '#root';
    this.react_router_instance = options.react_router_instance;
    this.react_instance = options.react_instance;

    require(this.babel_config);

    require(this.routes_file)['default']({
      entry: entry => {
        this.entry = entry;
      },
      add: route => {
        this.routes.push(route);
      }
    });
  }

  getErrorPage(code) {
    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i];

      if (route.error === code) {
        return {
          route,
          route_index: i,
          params: {}
        };
      }
    }

    return null;
  }

  resolve(url) {
    const url_parts = (url || '').split('?')[0].split('#')[0].split('/').filter(p => p);
    if (!url_parts.length) url_parts.push('/');
    let error404 = null;

    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i];

      if (route.error === 404) {
        error404 = {
          route,
          route_index: i,
          params: {}
        };
      }

      if (!route.path) continue;
      const route_parts = route.path.split('/').filter(p => p);
      if (!route_parts.length) route_parts.push('/');
      if (url_parts.length != route_parts.length) continue;
      let dont_match = false;
      const params = {};

      for (let i in params) {
        const part = (params[i] || '').toLocaleLowerCase();
        const url_part = (url_parts[i] || '').toLocaleLowerCase();

        if (part.startsWith(':')) {
          params[part.substr(1)] = url_part;
        } else if (url_part !== part) {
          dont_match = true;
          break;
        }
      } //route dont match


      if (dont_match) continue;
      return {
        params,
        route,
        route_index: i
      };
    }

    if (error404) return error404;
    return {
      params: {},
      route: null,
      route_index: -1
    };
  }

  async render(request, options, resolved_route) {
    options = options || {};
    const {
      route_index,
      route,
      params
    } = resolved_route || this.resolve(request.url);
    let rendered;

    if (route_index === -1) {
      //default 404
      //404
      rendered = {
        context: {
          status: 404
        },
        html: ''
      };
    } else {
      //add route path
      request.route = route.path; //change mark as server

      request.is_server = true; //add params

      request.params = params;
      request.search = request.search || '';
      request.query = new URLSearchParams(request.search);

      if (request.search && request.search.indexOf('?') !== 0) {
        request.search = `?${request.search}`;
      } //render


      rendered = await this.renderer.render({
        babel_config: this.babel_config,
        html_file: this.html_file,
        routes_file: this.routes_file,
        max_memory: this.max_memory,
        remove_images: this.remove_images,
        route_index,
        assets: this.assets,
        root_element: this.root_element,
        react_router_instance: this.react_router_instance,
        react_instance: this.react_instance,
        ...options,
        request
      });
    }

    return rendered;
  }

  register(server, type, interceptor) {
    let apply_route;

    const render = async (render_request, route_index) => {
      let rendered;
      const render_options = {
        babel_config: this.babel_config,
        html_file: this.html_file,
        routes_file: this.routes_file,
        max_memory: this.max_memory,
        remove_images: this.remove_images,
        request: render_request,
        route_index,
        assets: this.assets,
        root_element: this.root_element,
        react_router_instance: this.react_router_instance,
        react_instance: this.react_instance
      };

      if (typeof interceptor === 'function') {
        rendered = await interceptor(render_request, {
          render: async (request, options) => {
            options = options || options;
            return await this.renderer.render({ ...render_options,
              ...options,
              request
            });
          }
        });
      } else {
        rendered = await this.renderer.render(render_options);
      }

      return rendered;
    };

    switch (type) {
      case 'fastify':
        const fastify_request_handler = async (request, reply, route, route_index) => {
          let [url, search] = request.raw.url.split('?');
          const protocol = request.socket.encrypted ? 'https:' : 'http:';

          if (search) {
            search = `?${search}`;
          }

          const render_request = {
            url: url,
            params: request.params,
            //will be reset using search
            query: new URLSearchParams(search || ''),
            search: search || '',
            host: request.headers.host,
            hostname: request.hostname,
            protocol: protocol,
            origin: `${protocol}//${request.headers.host}`,
            is_server: true,
            route: route.path,
            cookies: request.cookies || {},
            headers: request.headers
          };
          const rendered = await render(render_request, route_index); //set cookies

          if (rendered.context.cookies && reply.setCookie) {
            for (let i in rendered.context.cookies) {
              const cookie = rendered.context.cookies[i]; // cookie.options = { domain:string, path:string, signed:bool, expires:number }

              reply.setCookie(cookie.name, cookie.value, cookie.options);
            }
          } //handle redirects


          if (rendered.context.url) {
            if (rendered.context.status != 301 && rendered.context.status != 302) return reply.redirect(302, rendered.context.url);
            return reply.redirect(rendered.context.status, rendered.context.url);
          } //404 page


          if (rendered.context.status === 404) {
            reply.type('text/html').code(404);
            let htmlError = rendered.html || '404 Internal Error';
            const error = this.getErrorPage(404);

            if (error) {
              try {
                const rendered_error = await render(render_request, error.route_index);
                htmlError = rendered_error.html || htmlError;
              } catch (err) {}
            }

            return htmlError;
          } //500 page


          if (rendered.context.status === 500) {
            reply.type('text/html').code(500);

            if (rendered.context.error) {
              console.error(rendered.context.error);
            }

            let htmlError = rendered.html || '500 Internal Error';
            const error = this.getErrorPage(500);

            if (error) {
              try {
                const rendered_error = await render(render_request, error.route_index);
                htmlError = rendered_error.html || htmlError;
              } catch (err) {}
            }

            return htmlError;
          } //send html


          reply.type('text/html').code(rendered.context.status || 200);
          return rendered.html;
        };

        apply_route = (route, route_index) => {
          if (route.error === 404) {
            server.setNotFoundHandler(async (request, reply) => await fastify_request_handler(request, reply, route, route_index));
          }

          if (!route.path) return;
          server.get(route.path, async (request, reply) => await fastify_request_handler(request, reply, route, route_index));
        };

        break;

      case 'express':
        const express_request_handler = async (request, reply, route, route_index) => {
          let [url, search] = request.originalUrl.split('?');
          const protocol = `${request.protocol}:`;

          if (search) {
            search = `?${search}`;
          }

          const render_request = {
            url: url,
            params: request.params,
            //will be reset using search
            query: new URLSearchParams(search || ''),
            search: search || '',
            host: request.headers.host,
            hostname: request.hostname,
            protocol: protocol,
            origin: `${protocol}//${request.headers.host}`,
            is_server: true,
            route: route.path || route.error,
            cookies: request.cookies || {},
            headers: request.headers
          };
          const rendered = await render(render_request, route_index); //set cookies

          if (rendered.context.cookies && reply.cookies) {
            for (let i in rendered.context.cookies) {
              const cookie = rendered.context.cookies[i]; // cookie.options = { domain:string, path:string, signed:bool, expires:number }

              let options;

              if (cookie.options) {
                options = { ...cookies.options
                };

                if (cookies.options.expires) {
                  options.expires = new Date(cookies.options.expires);
                }
              }

              reply.cookies(cookie.name, cookie.value, options);
            }
          } //handle redirects


          if (rendered.context.url) {
            return reply.redirect(rendered.context.status || 302, rendered.context.url);
          } //404 page


          if (rendered.context.status === 404) {
            let htmlError = rendered.html || '404 Internal Error';
            const error = this.getErrorPage(404);

            if (error) {
              try {
                const rendered_error = await render(render_request, error.route_index);
                htmlError = rendered_error.html || htmlError;
              } catch (err) {}
            }

            return reply.type('text/html').status(404).send(htmlError || '404 Not Found');
          } //500 page


          if (rendered.context.status === 500) {
            if (rendered.context.error) {
              console.error(rendered.context.error);
            }

            let htmlError = rendered.html || '500 Internal Error';
            const error = this.getErrorPage(500);

            if (error) {
              try {
                const rendered_error = await render(render_request, error.route_index);
                htmlError = rendered_error.html || htmlError;
              } catch (err) {}
            }

            return reply.type('text/html').status(500).send(htmlError || '500 Internal Error');
          } //send html


          return reply.type('text/html').status(rendered.context.status || 200).send(rendered.html);
        };

        let error404 = null;

        apply_route = (route, route_index) => {
          if (route.error === 404) {
            error404 = {
              route,
              route_index
            };
          }

          if (!route.path) return;
          server.get(route.path, async (request, response) => await express_request_handler(request, response, route, route_index));
        };

        if (error404) {
          //register 404
          server.use(async (request, response) => await express_request_handler(request, response, error404.route, error404.route_index));
        }

        break;

      case 'http':
      case 'https':
      case 'node':
      default:
        throw new Error('Native http/https modules are not implemented yet :c');
    }

    this.routes.forEach(apply_route);
  }

}

module.exports = Router;