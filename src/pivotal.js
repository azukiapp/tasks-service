import utils from "./utils";
import { Pivotal as Tracker } from './libs/pivotal.js';

// Dependencies
var R        = require('ramda');
var BPromise = require("bluebird");
var path     = require("path");
var fs       = BPromise.promisifyAll(require("fs"));

// Log
var chalk = require('chalk');

export class Pivotal extends Tracker {
  constructor(api_key, options) {
    super(api_key);

    options = R.merge({
      to: 'normalized.json'
    }, options);
    options.to   = path.resolve(process.cwd(), options.to);

    if (options.verbose) {
      utils.verbose = options.verbose;
    }

    this.options = options;
  }

  run() {
    utils.log("Read asana dump file", chalk.green(this.options.from));
    return BPromise.coroutine(function* () {
      var json, stories;

      json = yield this.readFile();

      try {
        stories = JSON.parse(json);
        stories = yield this.pushAllStories(stories);
      } catch (e) {
        throw e;
      }

      utils.log("Pushed", chalk.green(stories.length), "stories");

      // var json = JSON.stringify(workspace, null, 2);
      // this.saveFile(json);
      return stories;
    }.bind(this))();
  }

  readFile(filepath) {
    filepath = filepath || this.options.from;
    return fs.readFileAsync(filepath)
      .then(function (data) {
        utils.log("Successful read file " + chalk.green(filepath), "\n");
        return data.toString();
      })
      .catch(BPromise.OperationalError, function (e) {
        console.error("unable to read file, because: ", e.message, "\n");
      });
  }

  saveFile(json) {
    var filename = this.options.to;
    fs.writeFileAsync(filename, json)
      .then(function() {
        utils.log("Successful saved file " + chalk.green(filename), "\n");
      });
  }

  pushAllStories(stories) {
    utils.log("Start push", chalk.green(stories.length), "stories:");
    return BPromise.coroutine(function* () {
      var new_stories = [];

      for (var i in stories) {
        var story = stories[i];
        new_stories.push(yield this.pushStory(story, i));
      }
      return new_stories;
    }.bind(this))();
  }

  pushStory(story, index) {
    return BPromise.coroutine(function* () {
      var msg = (!R.isNil(index)) ? "    " + ((Number(index) + 1) + " ") : "  ";
      msg += "Push to project " + chalk.green(story.project_id) + " story ";
      msg += chalk.green(story.name);
      utils.log(msg);

      story = yield this.client.createStoryAsync(story.project_id, story);

      if (story.kind === 'error') {
        console.log('story:', story);
      }

      return story;
    }.bind(this))();
  }

  deleteAllStories(project_ids) {
    project_ids = project_ids || [];

    return BPromise.coroutine(function* () {
      for (var i in project_ids) {
        var project_id = project_ids[i];
        utils.log("Clean all tasks from project", chalk.green(project_id));

        var stories = yield this.client.getStoriesAsync(project_id).then((stories) => {
          return stories;
        });

        if (!stories.code) {
          for (var ix in stories) {
            var story = stories[ix];
            utils.log("    Remove task", chalk.green(story.id), "-", chalk.green(story.name));
            yield this.client.deleteStoryAsync(project_id, story.id);
          }
        } else {
          utils.log("    No tasks to remove!");
        }
      }
    }.bind(this))();
  }
}
