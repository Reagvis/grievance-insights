function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (
    (request.method !== 'GET' && request.method !== 'HEAD') ||
    uri === '/api' ||
    uri.indexOf('/api/') === 0 ||
    uri.indexOf('/.well-known/') === 0
  ) {
    return request;
  }

  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (uri.endsWith('/') || lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }

  return request;
}
