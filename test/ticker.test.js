var request = require('supertest');
var server = require('../server');

describe('GET /ticker/lookup', function() {
  it('should return ok', function(done) {
    request(server)
      .get('/ticker/lookup?text=MU')
      .expect(200, done);
  });
  it('should resolve MU to Micron', function(done) {
    request(server)
      .get('/ticker/lookup?text=MU')
      .expect(200)
      .then(response => {
        if (response.body.results[0].text.includes('Micron Technology'))
          done();
        else done('Response body did not include "Micron Technology"');
      });
  });
  it('should not resolve foreign stocks', function(done) {
    request(server)
      .get('/ticker/lookup?text=KRX')
      .expect(200)
      .then(response => {
        if (response.body.results[0].text.includes('Samsung'))
          done('Response included Samsung');
        else done();
      });
  });
});

describe('GET /ticker/details/[ticker]', function() {
  it('should be render ok', function(done) {
    request(server)
      .get('/ticker/details/TSLA')
      .expect(200,done);
  });
  it('should not be able to load foreign stocks', function(done) {
    this.timeout(10000);
    request(server)
      .get('/ticker/details/KRX')
      .expect(302,done);
  });
});