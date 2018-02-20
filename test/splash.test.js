var request = require('supertest');
var server = require('../server');
var splash = require('../controllers/splash');



describe('GET /', function() {
  it('should render ok', function(done) {
    request(server)
      .get('/')
      .expect(200, done);
  });
});


// describe('Splash Helper Functions', function() {
//   it('should format date', function(done) {
//     exports().formatDate()
//       .expect(200, done);
//   });
// });