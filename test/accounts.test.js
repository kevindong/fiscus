var request = require('supertest');
var server = require('../server');
var User = require('../models/User');
describe('The signup page', function() {
  const userDetails = {
    name: 'Testerino',
		email: 'test@test.com',
		password: 'Test123!',
	};
	before(function(done) {
		new User()
      .where({ email: userDetails.email })
      .destroy()
      .then(() => done());
  });
  it('should render properly', function(done) {
    request(server)
      .get('/signup')
      .expect(200)
      .expect(function(res) {
        if (!res.text.includes('Create An Account')) {
          throw new Error();
        }
      })
      .end(function(err) {
        if (err) {
          done(err);
        } else {
          done();
        }
      });
  });
  it('should be able to create an account', function(done) {
    request(server)
      .post('/signup')
      .send(userDetails)
      .expect(302)
      .expect('Location', '/')
      .end(function(err) {
        if (err) {
          done(err);
        } else {
          new User()
            .where({ email: userDetails.email })
            .fetch()
            .then(function(user) {
              if (user) {
                done();
              } else {
                done('Account not succesfully created');
              }
            });
        }
      });
  });
});

describe('Logging in', function() {
	const userDetails = {
		email: 'test@test.com',
		password: 'Test123!',
	};
	before(function(done) {
		new User()
      .where({ email: userDetails.email })
      .destroy()
      .then(function() {
        new User({ name: 'Testerino', email: userDetails.email, password: userDetails.password, isAdmin: false, isConfirmed: true, isBanned: false })
          .save()
          .then(() => done());
      });
	});
	var agent = request.agent(server);
	it('should log in', function(done) {
		agent.post('/login')
			.send(userDetails)
      .expect(302)
      .expect('Location', '/')
			.end(function(err, response) {
				if (err) {
					done(err);
				} else {
					done();
				}
			});
	});
	it('should be able to log out', function(done) {
		agent.get('/logout')
			.expect(302)
			.expect(function(res) {
				if (!res.text.includes('Found. Redirecting to /')) {
					throw new Error();
				}
			})
			.end(function(err) {
				if (err) {
					done(err);
				} else {
					done();
				}
			});
	});
});
describe('Resetting your password', function() {
  this.timeout(20000);
	const email = 'test@test.com';
	const oldPassword = 'Test123!';
	const newPassword = 'Test1234!';
	before(function(done) {
		new User()
		.where({ email })
		.destroy()
		.then(function() {
			new User({ name: 'Testerino', email, password: oldPassword, isAdmin: false, isConfirmed: true, isBanned: false })
				.save()
				.then(() => done());
		});
	});

	it('should have sent a working link', function(done) {
    //Tell the server we forgot our password
		request(server)
			.post('/forgot')
			.send({ email })
			.expect(302)
			.end(function(err, res) {
				if (err) {
					done(err);
				} else {
          //Then try the link sent to our email
					new User()
            .where({ email })
            .fetch()
            .then(function(user) {
              request(server)
                .get(`/reset/${user.attributes.passwordResetToken}`)
                .expect(200)
                .expect(function(res) {
                  if (!res.text.includes('Reset Password')) {
                    throw new Error();
                  }
                })
                .end(function(err) {
                  if (err) {
                    done(err);
                  } else {
                    done();
                  }
                });
            });
				}
			});
	});
	it('should allow the user to reset their password using their link and log in with the new password', function(done) {
    //Get the test user
		new User()
			.where({ email })
			.fetch()
			.then(function(user) {
        //Set the password to the new password
				request(server)
					.post(`/reset/${user.attributes.passwordResetToken}`)
					.send({ password: newPassword , confirm: newPassword })
					.expect(302)
					.end(function(err) {
						if (err) {
							done(err);
						} else {
              //Log in with the new password
              const agent = request.agent(server);
              agent.post('/login')
                .send({ email, password: newPassword })
                .expect(302)
                .expect('Location', '/')
                .end(function(err, response) {
                  if (err) {
                    done(err);
                  } else {
                    done();
                  }
                });
						}
					});
			});
	});
	it('should not allow the user to log in using their old password', function(done) {
		const agent = request.agent(server);
		agent.post('/login')
			.send({ email, password: oldPassword })
      .expect(302)
      .expect('Location', '/login')
			.end(function(err, response) {
				if (err) {
					done(err);
				} else {
					done();
				}
			});
	});
});
describe('Changing your profile', function() {
	const userDetails = {
		email: 'test@test.com',
		password: 'Test1234!',
  };
  const agent = request.agent(server);
	before(function(done) {
		new User()
      .where({ email: userDetails.email })
      .destroy()
      .then(function() {
        new User({ name: 'Testerino', email: userDetails.email, password: userDetails.password, isAdmin: false, isConfirmed: true, isBanned: false })
          .save()
          .then(function() {
            agent.post('/login')
              .send(userDetails)
              .expect(302)
              .expect('Location', '/')
              .end((function(err) {
                if (err) {
                  done(err);
                } else {
                  done();
                }
              }));
          });
      });
    new User()
      .where({ email: 'test2@test.com' })
      .destroy();
  });
  it('should have a working page', function(done) {
    agent.get('/account')
      .expect(200)
      .expect(function(res) {
				if (!res.text.includes('Profile Information')) {
					throw new Error();
				}
      })
      .end(function(err) {
        if (err) {
          done(err);
        } else {
          done();
        }
      });
  });
  it('should be able to change your name', function(done) {
    const newName = 'Testerino2';
    new User()
      .where({ email: userDetails.email })
      .fetch()
      .then(function(user) {
        const oldName = user.attributes.name;
        agent.put('/account')
          .send({ email: userDetails.email, name: newName })
          .expect(302)
          .expect('Location', '/account')
          .end(function(err) {
            if (err) {
              done(err);
            } else {
              new User()
                .where({ email: userDetails.email })
                .fetch()
                .then(function(user) {
                  if (user.attributes.name !== newName) {
                    done(`Name is ${user.attributes.name} but the new name should be ${newName}`);
                  } else {
                    done();
                  }
                });
            }
          });
      });
  });
  it('should be able to change your email', function(done) {
    const oldEmail = userDetails.email;
    const newEmail = 'test2@test.com';
    new User()
      .where({ email: oldEmail })
      .fetch()
      .then(function(user) {
        const name = user.attributes.name;
        agent.put('/account')
          .send({ email: newEmail, name })
          .expect(302)
          .expect('Location', '/account')
          .end(function(err) {
            if (err) {
              done(err);
            } else {
              new User()
                .where({ name })
                .fetch()
                .then(function(user) {
                  if (user.attributes.email !== newEmail) {
                    done(`Email is ${user.attributes.email} but the new email should be ${newEmail}`);
                  } else {
                    done();
                  }
                });
            }
          });
      });
  });
  it('should be able to change your password', function(done) {
    const oldPassword = userDetails.password;
    const newPassword = 'Test12345!';
    agent.put('/account')
      .send({ password: newPassword, confirm: newPassword })
      .expect(302)
      .expect('Location', '/account')
      .end(function(err) {
        if (err) {
          done(err);
        } else {
          //Logout and ensure we can log in with our new password
          agent.get('/logout');
          agent.post('/login')
            .send({ email: 'test2@test.com', password: newPassword })
            .expect(302)
            .expect('Location', '/')
            .end(function(err) {
              if (err) {
                done(err);
              } else {
                done();
              }
            });
        }
      });
  });
  it('should be able to delete your account', function(done) {
    agent.delete('/account')
      .expect(302)
      .expect('Location', '/')
      .end(function(err) {
        if (err) {
          done(err);
        } else {
          new User()
            .where({ email: 'test2@test.com' })
            .fetch()
            .then(function(user) {
              if (user) {
                done('Not deleted');
              } else {
                done()
              }
            });
        }
      });
  });
});