// Note that in test code we currently don’t use semicolon.
// NOTE: Technically, we shouldn’t need ts-mocha, just ts-node,
// but without ts-mocha Spectron reports “ChromeDriver failed to start”.

import { Application } from 'spectron'

import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

import path from 'path'

chai.use(chaiAsPromised)
chai.should()

// TODO: Make this platform-independent.
const electronPath = path.join(__dirname, '..', 'dist', 'mac', 'Paneron.app', 'Contents', 'MacOS', 'Paneron')

const app = new Application({
  path: electronPath,
  args: [path.join(__dirname, '..')],

  // A workaround for “DevToolsActivePort file doesn't exist”,
  // may or may not be necessary.
  //chromeDriverArgs: ['remote-debugging-port=12209'],

  chromeDriverLogPath: '../chromedriverlog.txt',
})


describe('Application launch', function () {

  this.timeout(20000);

  beforeEach(async function () {
    return await app.start()
  })

  beforeEach(function () {
    // This apparently requires app being a property of the suite (this.app), which causes it to lose typing.
    // Well, the type of implicit promise chaining that this should in theory enable doesn’t seem to work anyway.
    //chaiAsPromised.transferPromiseness = app.transferPromiseness
  })

  afterEach(async function () {
    if (app && app.isRunning()) {
      return await app.stop()
    } else {
      return
    }
  })

  it('opens a window', async function () {
    await app.client.waitUntilWindowLoaded()
    app.client.getWindowCount().should.eventually.have.at.least(1)
    app.browserWindow.isMinimized().should.eventually.be.false
    app.browserWindow.isVisible().should.eventually.be.true
    app.browserWindow.isFocused().should.eventually.be.true
    app.browserWindow.getBounds().should.eventually.have.property('width').and.be.above(0)
    app.browserWindow.getBounds().should.eventually.have.property('height').and.be.above(0)
  })

})
