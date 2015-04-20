import utils from "./utils";

// Dependencies
var R        = require('ramda');
var BPromise = require("bluebird");
var path     = require("path");
var fs       = BPromise.promisifyAll(require("fs"));
var Client   = require("asana").Client;

// Log
var chalk = require('chalk');

var color_index = ["red", "green", "yellow", "magenta", "blue",
                   "bgRed", "bgGreen", "bgCyan", "bgMagenta", "bgBlue"];

var colorize = function(index, string) {
  return chalk[color_index[index] || "gray"](string);
};

export class Asana {
  constructor(api_key, options) {
    options = R.merge({
      to      : 'debug.json',
      parallel: 10
    }, options);
    options.to   = path.resolve(process.cwd(), options.to);

    if (options.verbose) {
      utils.verbose = options.verbose;
    }

    this.client  = Client.create().useBasicAuth(api_key);
    this.options = options;
  }

  run(workspace_name, projects) {
    utils.log("Get tasks from projects", chalk.cyan(projects.join(chalk.white(', '))));
    return BPromise.coroutine(function* () {
      var workspace      = yield this._workspaceByName(workspace_name);
      workspace.projects = yield this._projectsByWorkspace(workspace, projects);

      var tasks       = yield this._tasksAllProjects(projects, workspace);
      workspace.tasks = tasks[0];
      utils.log("Save", chalk.green(workspace.tasks.length), "tasks");

      if (!R.isEmpty(tasks[1])) {
        workspace.errors = tasks[1] || [];
        utils.log("with", chalk.green(workspace.errors.length), "erros");
      }

      var json = JSON.stringify(workspace, null, 2);
      this.saveFile(json);
      return workspace;
    }.bind(this))();
  }

  saveFile(json) {
    var filename = this.options.to;
    fs.writeFileAsync(filename, json)
      .then(function() {
        utils.log("Successful saved file " + chalk.green(filename));
      });
  }

  _parallelTasks(elems, padding) {
    return BPromise.coroutine(function* () {
      var success = [];
      var errors  = [];
      var retry_after = 0;

      if (elems.length > 0) {
        utils.log(padding + "Get content of", chalk.cyan(elems.length), "tasks.\n");

        var parallel = this.options.parallel;
        var start = 0;

        while (start < elems.length) {
          var end = parallel + start;
          var multiple_promisses = [];

          for (var acc = start, i = 0; acc < end; acc++, i++) {
            var task = elems[acc];
            multiple_promisses.push(this._taskById(i, task, padding, acc));
          }

          yield BPromise.settle(multiple_promisses).then((results) => {
            for (var j in results) {
              var result = results[j];
              var elm_i  = Number(j) + start;
              var elm    = elems[elm_i];

              if (result.isFulfilled()) {
                success.push(result.value());
              } else if (result.isRejected()) {
                retry_after = Math.max(retry_after, result.reason().retryAfterSeconds) || retry_after;
                elm.error = result;
                // console.log('result:', result);
                errors.push(elm);
                // result.reason();
              }
            }
          });

          start = end;
        }
      }
      if (errors.length > 0) {
        // console.log(JSON.stringify(errors, null, 2));
        retry_after += 1;
        utils.log(padding + "Retry", chalk.cyan(errors.length), "tasks in", retry_after, "seconds.\n");
        yield BPromise.delay(retry_after * 1000);

        var retry = yield this._parallelTasks(errors, "      ");
        success.concat(retry[0]);
        errors = retry[1];
      }

      return [success, errors];
    }.bind(this))();
  }

  _taskById(i, task, padding, acc) {
    return BPromise.coroutine(function* () {
      if (task && task.id) {
        var tag = padding + colorize(i, "@" + acc);
        utils.log(tag, colorize(i, task.id + ":" ), "Find data of task", chalk.gray(task.name));
        padding += "  "; // increment padding to chields

        task = yield this.client.tasks.findById(task.id);
        // var attachments = yield this._attachmentsByTaskId(task.id);
        // task.attachments = attachments;

        var stories   = yield this._storiesByTaskId(i, task.id, padding, i)
          .error((err) => {
            utils.log(padding, " Error to get stories of task", colorize(i, task.id ), err);
            utils.log(padding, err);
          });
        task.stories  = this._storiesClean(stories);
        task.subtasks = yield this._subtasksByTaskID(i, task.id, padding, i)
          .error((err) => {
            utils.log(padding, " Error to get subtasks of task", colorize(i, task.id ), err);
            utils.log(padding, err);
          });

        return task;
      }
    }.bind(this))();
  }

  _tasksByProject(project) {
    utils.log("    " + chalk.cyan(project.id) + ": Find tasks to project", project.name);
    return BPromise.coroutine(function* () {
      var tasks = yield this.client.tasks
        .findByProject(project.id)
        .then((result) => result.data ? result.data : []);

      return this._parallelTasks(tasks, "      ");
    }.bind(this))();
  }

  _tasksAllProjects(projects, workspace) {
    return BPromise.coroutine(function* () {
      var tasks  = [];
      var errors = [];
      for (var i = 0; projects.length > i; i++) {
        var filter    = R.find(R.propEq('name', projects[i]));
        var project   = filter(workspace.projects);

        if (!R.isEmpty(project) && project.id) {
          var result = yield this._tasksByProject(project);

          tasks  = tasks.concat(result[0]);
          errors = errors.concat(result[1]);
        }
      }
      return [tasks, errors];
    }.bind(this))();
  }

  _attachmentsByTaskId(id) {
    utils.log("        Find attachments by task id", chalk.green(id));
    return BPromise.coroutine(function* () {
      var attachments = yield this.client.attachments.findByTask(id)
        .then((result) => result.data ? result.data : []);

      for (var ix = 0; ix < attachments.length; ix++) {
        attachments[ix] = yield this._attachmentById(attachments[ix]);
      }

      return attachments;
    }.bind(this))();
  }

  _attachmentById(attachment) {
    utils.log("          Find attachment", chalk.green(attachment.id), '-', attachment.name);
    return this.client.attachments.findById(attachment.id);
  }

  _subtasksByTaskID(task_index, id, padding, acc) {
    var tag = padding + colorize(task_index, "@" + acc);
    utils.log(tag, "Find subtasks from task", colorize(task_index, id));
    padding += "  "; // increment padding to chields

    return BPromise.coroutine(function* () {
      var subtasks = yield this.client.tasks
        .subtasks(id)
        .then((result) => result.data ? result.data : []);

      for (var i = 0; subtasks.length > i; i++) {
        subtasks[i] = yield this._taskById(task_index, subtasks[i], padding, i);
      }

      return subtasks;
      // return this._parallelTasks(subtasks, padding);
    }.bind(this))();
  }

  _storiesByTaskId(task_index, id, padding, acc) {
    var tag = padding + colorize(task_index, "@" + acc);
    utils.log(tag, "Find stories by task id", colorize(task_index, id));
    return this.client.stories
      .findByTask(id)
      .then((result) => result.data ? result.data : []);
  }

  // Remove system stories
  _storiesClean(stories) {
    if (R.isArrayLike(stories)) {
      var isntSystem = function(storie) {
        return storie.type !== "system";
      };
      stories = R.filter(isntSystem, stories);
    }
    return stories;
  }

  _projectsByWorkspace(workspace, projects) {
    utils.log("  Find projects in", chalk.green(workspace.id), '-', workspace.name);
    return BPromise.coroutine(function* () {
      var all_projects = yield this.client.projects
        .findAll({ workspace: workspace.id })
        .then((result) => result.data ? result.data : []);

      var inProjects = (project) => R.contains(project.name)(projects);
      var filtered_projects = R.filter(inProjects, all_projects);

      return filtered_projects;
    }.bind(this))();
  }

  _workspaceByName(workspace) {
    utils.log("Find workspace", chalk.green(workspace));
    return this.client.users.me()
      .then(function(user) {
        var filter = R.find(R.propEq('name', workspace));
        return filter(user.workspaces);
      });
  }
}
