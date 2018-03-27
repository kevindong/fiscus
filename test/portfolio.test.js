let request = require('supertest');
let server = require('../server');
let User = require('../models/User');
let Portfolio = require('../models/Portfolio');

describe('Portfolio Tests', function () {
  const userDetails = {
    email: 'portfolio@example.com',
    password: 'reeeeeeeeeee'
  };

  let agent = request.agent(server); // Create agent to login to
  let userId;

  // create login user to test with
  before(function (done) {
    new User()
      .where({ email: userDetails.email })
      .destroy()
      .then(function () {
        new User({ name: 'Testerino', email: userDetails.email, password: userDetails.password, isAdmin: false, isConfirmed: true, isBanned: false })
          .save()
          .then(function (u) {
            userId = u.get('id'); // Get User Id

            agent.post('/login')
              .send(userDetails)
              .expect(302)
              .expect('Location', '/')
              .end(function (err, response) {
                if (err) {
                  done(err);
                } else {
                  done()
                }
              });
          });
      });
  });

  // cleanup after tests
  after(function (done) {
    new User()
      .where({ email: userDetails.email })
      .destroy();
    done();
  });

  describe('Buy Tests', function() {
    before(function(done) {
      return new Portfolio({userId: userId})
        .save();
    });

    after(function(done) {
      return new Portfolio({userId: userId})
        .destroy();
    });

    it('Test Buy with No Portfolio', function(done) {

    })
  });



  // describe('Buy stock with no current portfolio', function () {
  //   it('should redirect to login page', function (done) {
  //     agent.get('/admin')
  //       .expect(302)
  //       .expect('Location', '/login')
  //       .end(function (err, response) {
  //         if (err) {
  //           done(err);
  //         } else {
  //           done();
  //         }
  //       });
  //   });
  // });

  // before('POST /login as an admin user', function () {
  //   agent.post('/login')
  //     .send(userDetails)
  //     .expect(302)
  //     .expect('Location', '/')
  //     .end(function (err, response) {
  //       if (err) {
  //         done(err);
  //       } else {
  //         done();
  //       }
  //     });
  // });

  // describe('GET /admin as an admin user', function () {
  //   it('should return ok', function (done) {
  //     agent.get('/admin')
  //       .expect(200)
  //       .end(function (err, response) {
  //         if (err) {
  //           done(err);
  //         } else {
  //           done();
  //         }
  //       });
  //   });
  // });
});
