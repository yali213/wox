import 'reflect-metadata';
import Vue from 'vue';
import Server from '@wox/server';
import Route from '@wox/router';
import Client from '@wox/loader/client';
import Basic from '@wox/basic';
import Page from './page';
import DirectiveComponent from './directives';
import { hashChange, popState } from '@wox/history';

export default class WoxApplication extends Server {
  constructor(loadConfigs) {
    super();
    this.config = {};
    this.plugins = {};
    this.env = process.env.NODE_ENV || 'development';
    this.installed = false;
    this.Router = new Route();
    this.Client = new Client(this);
    this.parseConfigs(loadConfigs);
    this.context.fetch = this.fetch.bind(this);
    this.context.get = this.get.bind(this);
    this.context.post = this.post.bind(this);
    this.context.put = this.put.bind(this);
    this.context.delete = this.delete.bind(this);
    this.context.render = async (webview, props) => {
      if (this.vue) {
        if (typeof webview === 'function' && webview.async) webview = await webview();
        this.vue.webview = webview;
        this.vue.props = props;
      }
    }
  }

  async fetch(options) {
    const ctx = await this.history._handler(options.url, options.method, options.body);
    ctx.status = ctx.status || 200;
    if (ctx.status !== 200) {
      if (ctx.error instanceof Error || Object.prototype.toString.call(ctx.error) === '[object Error]') throw ctx.error;
      const err = new Error('Service Error');
      err.status = err.code = ctx.status;
      throw err;
    }
    return ctx.body;
  }

  get(url) {
    return this.fetch({
      url,
      method: 'GET'
    })
  }

  post(url, body) {
    return this.fetch({
      url, body,
      method: 'POST'
    })
  }

  put(url, body) {
    return this.fetch({
      url, body,
      method: 'PUT'
    })
  }

  delete(url) {
    return this.fetch({
      url,
      method: 'DELETE'
    })
  }

  redirect(...args) { 
    this.history.redirect(...args);
  }

  replace(...args) {
    this.history.replace(...args);
  }

  reload(...args) {
    this.history.reload(...args);
  }

  parseConfigs(configs) {
    const client = this.Client;
    client.Plugin(configs.Plugin);
    delete configs.Plugin;
    for (const channel in configs) {
      if (client[channel]) {
        client[channel](configs[channel]);
      }
    }
  }
  
  createPage() {
    const root = global.document.createElement('div');
    global.document.body.appendChild(root);
    Vue.prototype.$wox = this;
    Vue.component('WoxPage', Page);
    DirectiveComponent(this, Vue);
    if (this.Components) this.Components(Vue);
    if (this.AsyncComponents) this.AsyncComponents(Vue);
    if (this.Directives) this.Directives(this, Vue);
    if (this.Filters) this.Filters(this, Vue);
    const initData = {
      webview: null,
      props: null,
    }
    const options = {
      el: root,
      name: 'WoxApplication',
      data: () => initData,
      render: h => {
        if (this.Bootstrap) return h(this.Bootstrap);
        return h(Page);
      }
    };
    this.emit('setup', options);
    this.vue = new Vue(options);
  }

  createProcess() {
    global.WOX_ROUTER_COMPONENTS.forEach(controller => {
      const $router = new Route();
      const prefix = Reflect.getMetadata('Controller', controller);
      const uses = Reflect.getMetadata('Use', controller);
      if (!prefix) return;
      for (const property of Object.getOwnPropertyNames(controller.prototype)) {
        if (property === 'constructor') continue;
        const result = [];
        const middleware = Reflect.getOwnMetadata('Middleware', controller.prototype[property]);
        const extras = Reflect.getOwnMetadata('Middleware', controller.prototype[property]);
        const getters = Basic.Methods.map(method => {
          const httpMethodMetadata = Reflect.getOwnMetadata(method, controller.prototype[property]);
          if (!httpMethodMetadata) return;
          httpMethodMetadata.method = method;
          return httpMethodMetadata;
        }).filter(properties => !!properties);
        if (!getters.length) continue;
        if (getters.length > 1) {
          throw new Error(`You can not set multi HTTP methods on '${property}: ${getters.map(getter => getter.method).join(',')}'`);
        }
        const getter = getters[0];
        if (middleware) {
          for (let n = 0; n < middleware.length; n++) {
            result.push(Basic.RenderMiddlewareArguments(
              this.Middleware, 
              middleware[n]
            ));
          }
        }
        this.emit('decorate', { property, prefix, getter, extras, controller, result });
        result.push(async (ctx, next) => {
          const cacheClassObject = controller.__cacheClass__;
          if (cacheClassObject) {
            cacheClassObject.ctx = ctx;
            return await cacheClassObject[getter.property].call(cacheClassObject, ctx, next);
          }
          const obj = new controller(ctx);
          controller.__cacheClass__ = obj;
          return await obj[getter.property].call(obj, ctx, next);
        });
        $router[getter.method.toLowerCase()](getter.path, ...result);
      }
      
      const ControllerPrepareMiddlewares = uses 
        ? uses.map(middle => Basic.RenderMiddlewareArguments(this.Middleware, middle)) 
        : [];
      ControllerPrepareMiddlewares.push($router.routes());
      this.Router.use(prefix, ...ControllerPrepareMiddlewares);
    });
  }

  async createServer() {
    if (this.AppRuntime) await this.AppRuntime(this);
    this.createProcess();
    this.emit('beforeCreate');
    this.createPage();
    this.emit('created');
    this.use(this.Router.routes());
    if (this.historyRemoveListener) this.historyRemoveListener();
    this.history = this.config.history === 'html5' ? new popState() : new hashChange();
    this.emit('beforeMount');
    this.historyRemoveListener = this.history
      .createServer(this.callback())
      .listen();
    this.installed = true;
    this.emit('mounted');
  }
}