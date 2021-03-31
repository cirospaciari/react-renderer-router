
const ReactDOMServer = require('react-dom/server');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

function contextClean(context) {
    delete context.route;
    delete context.entry;
    return context;
}


function renderAsync(element) {
    const body = [];
    return new Promise((resolve, reject) => {
        const bodyStream = ReactDOMServer.renderToNodeStream(element);
        bodyStream.on('data', (chunk) => {
            body.push(chunk.toString());
        });
        bodyStream.on('error', (error) => {
            reject(error);
        });
        bodyStream.on('end', () => {
            resolve(body.join(''));
        });
    });

}
module.exports = async function render(scope, params) {
    let { html_file, routes_file, request, route_index, remove_images, root_element, react_router_instance, react_instance } = params;

    if (react_router_instance) {
        global['react-router-dom'] = require(react_router_instance);
    }
    if (react_instance) {
        global['react'] = require(react_instance);
    }


    const React = (global['react'] || require('react'));
    const { Fragment } = React;
    const App = require('@react-renderer/app')['default'];

    const { getLazyCallbacks, resetLazyCallbacks, lazyCapture } = require('@react-renderer/app');

    try {

        //load routes if need
        if (scope.routes_file !== routes_file) {
            scope.routes = [];
            scope.directory = path.dirname(routes_file);
            require(routes_file)['default']({
                entry(entry) {
                    scope.entry_point = entry;
                },
                add(route) {
                    scope.routes.push(route);
                }
            });
            scope.routes_file = routes_file;
            scope.routes_lazy_components = getLazyCallbacks();
            resetLazyCallbacks();
        }
        //load html if need
        if (scope.html_file !== html_file) {
            scope.html = fs.readFileSync(html_file, 'utf8');
            scope.html_file = html_file;
        }


        const route = scope.routes[route_index];
        if (route.ignoreSSR) {
            return { html: scope.html, context: { status: 200 } };
        }

        const dom_operations = [];
        //start new context
        const context = {};
        const reply = {
            status(code){
                context.status = code;
            },
            redirect(url) {
                context.url = url;
                return '';
            },
            setCookie(name, value, options) {
                context.cookies = context.cookies || {};
                context.cookies[name] = { name, value, options };
            },
            html: {
                insertBefore(selector, htmlStringOrComponent, limiter) {
                    const operation = { type: 'insert-before', selector, limiter };
                    if (typeof htmlStringOrComponent === 'string') {
                        operation.html = htmlStringOrComponent;
                    } else {
                        operation.component = htmlStringOrComponent;
                    }

                    dom_operations.push(operation);
                },
                insertAfter(selector, htmlStringOrComponent, limiter) {
                    const operation = { type: 'insert-after', selector, limiter };
                    if (typeof htmlStringOrComponent === 'string') {
                        operation.html = htmlStringOrComponent;
                    } else {
                        operation.component = htmlStringOrComponent;
                    }

                    dom_operations.push(operation);
                },
                append(selector, htmlStringOrComponent, limiter) {
                    const operation = { type: 'append', selector, limiter };
                    if (typeof htmlStringOrComponent === 'string') {
                        operation.html = htmlStringOrComponent;
                    } else {
                        operation.component = htmlStringOrComponent;
                    }

                    dom_operations.push(operation);
                },
                setAttribute(selector, attribute_name, value, limiter) {
                    dom_operations.push({ type: 'set-attributes', selector, attributes: { [attribute_name]: value }, limiter });
                },
                setAttributes(selector, attributes, limiter) {
                    dom_operations.push({ type: 'set-attributes', selector, attributes, limiter });
                },
                removeAttribute(selector, attribute_name, limiter) {
                    dom_operations.push({ type: 'remove-attributes', selector, attributes: [attribute_name], limiter });
                },
                removeAttributes(selector, attributes, limiter) {
                    dom_operations.push({ type: 'remove-attributes', selector, attributes, limiter });
                },
                remove(selector, limiter) {
                    dom_operations.push({ type: 'remove', selector, limiter });
                }
            }
        }



        request.query = new URLSearchParams(request.search);

        const entry_state = { is_fetching: false, model: null };
        let entry_component = null;
        if (scope.entry_point) {
            entry_component = scope.entry_point.component;

            const entry_fetch = scope.entry_point.fetch || (entry_component).fetch;
            if (typeof entry_fetch === 'function') {
                request.entry = entry_fetch({ ...request, params: undefined, route: undefined }, reply);
            }
        }

        //pre-execute lazy route
        const component_isLazy = scope.routes_lazy_components.find((lazy) => lazy.isEqual(route.component));
        if (component_isLazy) {
            await component_isLazy.callback();
            route.component.fetch = component_isLazy.component.fetch || (component_isLazy.component.default && component_isLazy.component.default.fetch);
            route.component.helmet = component_isLazy.component.helmet || (component_isLazy.component.default && component_isLazy.component.default.helmet);
        }
        const route_fetch = route.fetch || route.component.fetch;
        let [entry_model, model] = await Promise.all([request.entry || null, typeof route_fetch === 'function' ? await route_fetch(request, reply) : null]);
        entry_state.model = entry_model;


        if (context.url) { //redirect
            context.status = 302;
            return { html: '', context: contextClean(context) };
        }
        const $ = cheerio.load(scope.html);
        //use while because lazy imports can add more lazy imports!
        while (true) {
            //pre-execute lazy callbacks
            const lazyCallbacks = getLazyCallbacks().filter((lazy) => !lazy.component && (lazy.options || {}).ssr !== false);
            if (lazyCallbacks.length <= 0) {
                break;
            } 
            await Promise.all(lazyCallbacks.map((lazy) => {
                return lazy.callback();
            }));
        }

        const headElement = $('head');
        lazyCapture((component)=>{
            if(component && component.__css){
                component.__css.forEach((file)=> {
                    headElement.append(`<link href="${file}" rel="stylesheet">`);
                });
                
            }
        });
        const Helmet = (route || {}).helmet || route.component.helmet || (() => <Fragment />);


        const element = <App entry={scope.entry_point} entry_state={entry_state} context={context} request={request} model={model} routes={scope.routes} />;
        const helmet = <Helmet model={model} />

        let [body, header_html] = await Promise.all([renderAsync(element), renderAsync(helmet)]);

        const container = $.load(`<head>${header_html}</head>`);

        const title = (container('title').text() || '').split('<!-- -->').join('');
        container('head').children().each(function () {
            $(this).attr('data-helmet', 'true');
            $(this).removeAttr('data-reactroot');

            headElement.append(this);
        });

        headElement.find('title').text(title);

        const preload_action = route.preload || route.component.preload;
        if (typeof preload_action === 'function') {
            model = await preload_action(model);
        }
        let preload = preload_action !== false;
        let preload_entry = false;

        if (scope.entry_point) {
            const entry_preload_action = scope.entry_point.preload || entry_component.preload;
            if (entry_preload_action !== false) {
                preload_entry = true;

                if (!preload) {
                    preload = true;
                }
            }

            if (typeof entry_preload_action === 'function') {
                entry_state.model = await entry_preload_action(entry_state.model);
            }
        }

        if (preload) {
            const script = $(`<script>`);
            
            script.html(`(function(global){ global.__PRELOADED_STATE__ = ${JSON.stringify({
                is_fetching: false,
                model: preload_action !== false ? model : null,
                is_server: false,
                request: preload_action !== false ? {
                    url: request.url,
                    search: request.search
                } : null,
                entry_state: preload_entry ? entry_state : null
            }).replace(/</g, '\\u003c')}})(window)`);
            $(script).insertBefore($('script').first());
        }
        $(root_element).html(body);

        if (remove_images) {
            $(remove_images || 'img,svg').remove();//ignore images
        }

        try {
            dom_operations.forEach((operation) => {

                let target = $(operation.selector);
                if (operation.limiter) {
                    switch (operation.limiter) {
                        case 'first':
                            target = target.first();
                            break;
                        case 'last':
                            target = target.last();
                            break;
                        default:
                            console.error('Invalid dom manipulation, limiter need to be first or last', { invalidLimiter: operation.limiter })
                            return;
                    }
                }

                let element = null;
                if (operation.html) {
                    element = $(operation.html).first();
                } else if (operation.component) {
                    const Component = operation.component;
                    operation.html = ReactDOMServer.renderToString(<Component />);
                    element = $(operation.html).first();
                    element.removeAttr('data-reactroot');
                }

                switch (operation.type) {

                    case 'remove':
                        target.remove();
                        break;
                    case 'remove-attributes':
                        if (operation.attributes instanceof Array) {
                            operation.attributes.forEach((attribute) => {
                                target.removeAttr(attribute);
                            });
                        } else if (typeof operation.attributes === 'string') {
                            target.removeAttr(operation.attributes);
                        } else {
                            console.error('Invalid parameters in', 'reply.removeAttribute(string, string|Array)');
                        }
                        break;
                    case 'set-attributes':
                        if (typeof operation.attributes === 'object') {
                            for (let i in operation.attributes) {
                                target.attr(i, operation.attributes[i] + "");
                            }
                        } else {
                            console.error('Invalid parameters in', 'reply.setAttribute(string, object)');
                        }
                        break;
                    case 'append':
                        element.appendTo(target);
                        break;
                    case 'insert-before':
                        element.insertBefore(target);
                        break;
                    case 'insert-after':
                        element.insertAfter(target);
                        break;
                    default:
                        break;
                }
            });
        } catch (ex) {
            console.error('Fail to execute DOM operation in SSR', ex);
        }

        if (!context.status) {
            context.status = 200;
        }
        $('[data-ssr="ignore"]').remove();
        resetLazyCallbacks();

        return { html: $.html(), context: contextClean(context) };

    } catch (error) {
        resetLazyCallbacks();

        try {
            const context = {};
            const entry_state = {
                is_fetching: false,
                model: null
            };
            const model = { error: error + "" };
            const $ = cheerio.load(scope.html);
            request.query = new URLSearchParams(request.search);

            //pre-execute lazy route
            const component_isLazy = scope.routes_lazy_components.find((lazy) => lazy.isEqual(route.component));
            if (component_isLazy) {
                await component_isLazy.callback();
                route.component.helmet = component_isLazy.component.helmet || (component_isLazy.component.default && component_isLazy.component.default.helmet);
            }

    
            if (context.url) { //redirect
                context.status = 302;
                return { html: '', context: contextClean(context) };
            }
            //use while because lazy imports can add more lazy imports!
            while (true) {
                //pre-execute lazy callbacks
                const lazyCallbacks = getLazyCallbacks().filter((lazy) => !lazy.component && (lazy.options || {}).ssr !== false);
                if (lazyCallbacks.length <= 0) {
                    break;
                } 
                await Promise.all(lazyCallbacks.map((lazy) => {
                    return lazy.callback();
                }));
            }
    
            const headElement = $('head');
            lazyCapture((component)=>{
                if(component && component.__css){
                    component.__css.forEach((file)=> {
                        headElement.append(`<link href="${file}" rel="stylesheet">`);
                    });
                    
                }
            });
            const Helmet = (route || {}).helmet || route.component.helmet || (() => <Fragment />);

            //pre-execute lazy callbacks
            await Promise.all(getLazyCallbacks().filter((lazy) => !lazy.component && (lazy.options || {}).ssr !== false).map((lazy) => {
                return lazy.callback();
            }));


            const body = await renderAsync(<App entry_state={entry_state} context={context} error500={true} request={request} model={model} routes={scope.routes} />);

        
            const header_html = await renderAsync(<Helmet model={model} />);

            const container = $.load(`<head>${header_html}</head>`);

            const title = (container('title').text() || '').split('<!-- -->').join('');
            container('head').children().each(function () {
                $(this).attr('data-helmet', 'true');
                $(this).removeAttr('data-reactroot');

                headElement.append(this);
            });

            headElement.find('title').text(title);

            const script = $(`<script>`);
            script.html(`(function(global){ global.__PRELOADED_STATE__ = ${JSON.stringify({
                is_fetching: false,
                model,
                is_server: false,
                request: {
                    url: request.url,
                    search: request.search
                },
                error500: true,
                entry_state
            }).replace(/</g, '\\u003c')}})(window)`);
            $(script).insertBefore($('script').first());

            $(root_element).html(body);

            if (remove_images) {
                $(remove_images || 'img,svg').remove();//ignore images
            }

            $('[data-ssr="ignore"]').remove();
            context.status = 500;
            resetLazyCallbacks();
            return { html: $.html(), context: contextClean(context) };

        } catch (ex) { //try to show error 500 page if fail go to fallback
            resetLazyCallbacks();

            return { html: '', context: { error: error + "", status: 500 } };
        }
    }
}