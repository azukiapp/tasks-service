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
      to             : 'debug.json',
      parallel       : 10,
      completed_since: (new Date("2013")).toISOString()
    }, options);
    options.to   = path.resolve(process.cwd(), options.to);

    if (options.verbose) {
      utils.verbose = options.verbose;
    }

    this.client  = Client.create({
      retryOnRateLimit: true
    }).useBasicAuth(api_key);
    this.options = options;
  }

  run(workspace_name, projects) {
    utils.log("Get tasks from projects", chalk.cyan(projects.join(chalk.white(', '))));
    return BPromise.coroutine(function* () {
      var workspace      = yield this._workspaceByName(workspace_name);
      workspace.projects = yield this._projectsByWorkspace(workspace, projects);

      var result = yield this._tasksAllProjects(projects, workspace);
      workspace.tasks = result.tasks;
      utils.log("Save", chalk.green(workspace.tasks.length), "tasks");

      if (!R.isEmpty(result.errors)) {
        workspace.errors = result.errors || [];
        utils.log("with", chalk.red(workspace.errors.length), "erros");
      }

      if (!R.isEmpty(result.total_length)) {
        workspace.total_length = result.total_length;
        utils.log(" from total of", chalk.red(workspace.total_length), "tasks");
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
      var tasks       = [];
      var errors      = [];
      var retry_after = 0;

      if (elems.length > 0) {
        utils.log(padding + "Get content of", chalk.cyan(elems.length), "tasks.\n");

        var parallel = this.options.parallel;
        var start = 0;

        while (start < elems.length) {
          var end = Math.min(parallel + start, elems.length);
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
                utils.log(
                  chalk.green(
                    padding + '  Success in get',
                    colorize(j, "@" + elm_i),
                    colorize(j, "@" + elm.id),
                    elm.name
                  )
                );

                tasks.push(result.value());
              } else if (result.isRejected()) {
                utils.log(
                  chalk.red(
                    padding + '  Error to get task',
                    colorize(j, "@" + elm_i),
                    colorize(j, "@" + elm.id),
                    result.reason().message
                  )
                );

                retry_after = Math.max(retry_after, result.reason().retryAfterSeconds) || retry_after;
                elm.error   = result;

                errors.push(elm);
              }
            }
          });

          start = end;
        }
      }

      return { tasks, errors, retry_after };
    }.bind(this))();
  }

  _taskById(i, task, padding, acc, is_subtask) {
    return BPromise.coroutine(function* () {
      var tag = padding + colorize(i, "@" + acc);
      utils.log(tag, colorize(i, task.id + ":" ), "Find data of task", chalk.gray(task.name));
      padding += "  "; // increment padding to chields

      try {
        task = yield this.client.tasks.findById(task.id);
        // var attachments = yield this._attachmentsByTaskId(task.id);
        // task.attachments = attachments;

        if (!is_subtask) {
          task.subtasks = yield this._subtasksByTaskID(i, task.id, padding, i);
          task.stories  = yield this._storiesByTaskId(i, task.id, padding, i);
        }
      } catch (e) {
        task = yield this._taskById(i, task, padding, acc);
        console.log(chalk.red(e));
      }

      return task;
    }.bind(this))();
  }

  _tasksByProject(project) {
    utils.log("\n\n    --------------------------");
    utils.log("    " + chalk.cyan(project.id) + ": Find tasks to project", project.name);

    return BPromise.coroutine(function* () {
      var tasks_list = yield this.client.tasks
        .findByProject(project.id, {
          limit          : 100,
          completed_since: "now"
        })
        .then((result) => result.data ? result.data : []);

      var tasks        = [];
      var errors       = [];
      var total_length = tasks_list.length;

      do {
        var result = yield this._parallelTasks(tasks_list, "      ");
        tasks      = tasks.concat(result.tasks);
        errors     = result.errors;

        if (!R.isEmpty(errors)) {
          utils.log("      Retry", chalk.cyan(errors.length),
            "tasks in", result.retry_after, "seconds.\n");
          yield BPromise.delay(result.retry_after * 1000);
        }
      } while (!R.isEmpty(errors));

      return { tasks, errors, total_length };
    }.bind(this))();
  }

  _tasksAllProjects(projects, workspace) {
    return BPromise.coroutine(function* () {
      var tasks  = [];
      var errors = [];
      var total_length = 0;

      for (var i = 0; projects.length > i; i++) {
        var filter    = R.find(R.propEq('name', projects[i]));
        var project   = filter(workspace.projects);

        if (!R.isEmpty(project) && project.id) {
          var result = yield this._tasksByProject(project);

          tasks  = tasks.concat(result.tasks);
          errors = errors.concat(result.errors);
          total_length += result.total_length;
        }
      }

      return { tasks, errors, total_length };
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
        subtasks[i] = yield this._taskById(task_index, subtasks[i], padding, i, true);
      }

      return subtasks;
    }.bind(this))();
  }

  _storiesByTaskId(task_index, id, padding, acc) {
    var tag = padding + colorize(task_index, "@" + acc);
    utils.log(tag, "Find stories by task id", colorize(task_index, id));
    return this.client.stories
      .findByTask(id)
      .then((result) => result.data ? result.data : []);
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
