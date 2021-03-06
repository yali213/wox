import delegator from './delegator';
import WoxError from './error';

const proto = {
  error(msg, code = 500) {
    return new WoxError(msg instanceof Error ? msg.message : msg, code);
  },
  render(webview, props) {
    this.status = 200;
    return this.app.render(webview, props);
  }
};

const response = new delegator(proto, 'response');
const request = new delegator(proto, 'request');

response.method('redirect')
  .method('replace')
  .method('reload')
  .method('fetch')
  .method('get')
  .method('post')
  .method('put')
  .method('delete');

request.access('search')
  .access('method')
  .access('query')
  .access('path')
  .access('url')
  .access('body')
  .access('referer')
  .getter('protocol')
  .getter('host')
  .getter('hostname')
  .getter('secure')
  .getter('isapi')
  .access('referer');


export default proto;