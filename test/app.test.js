var request = require('supertest');
var server = require('../server');

describe('GET /', function() {
  it('should render ok', function(done) {
    this.timeout(10000);
    request(server)
      .get('/')
      .expect(200, done);
  });
});
