# asana-pivotal

`asana-pivotal` follow `azk` standards to create new npm packages.
Search for `asana-pivotal` to find what have to be changed before upload.

- **src**:  all files will transpiled with babel to lib/src
- **spec**: all files will transpiled with babel to lib/spec
- **bin**:  no ocours transpilation here

#### Before start development

- Reset git:

    ```shell
    $ rm -rf .git
    $ git init
    ```

- Install/Update dependencies:

    ```shell
    $ npm install --save-dev azk-dev
    $ gulp editor:config
    $ gulp babel:runtime:install
    $ npm install
    ```

- Commit

    ```shell
    $ git add .
    $ git commit -m 'Start the project based on the `azk-projects-boilerplate`.'
    ```

## azk-dev

Show all gulp tasks:

```shell
$ gulp help
```

#### Tests

```shell
# default (lint + test, no watch)
$ gulp lint test

# test + lint + watch
$ gulp watch:lint:test

# test + watch (no-lint)
$ gulp watch:test
```


#### Deploy npm package

You can deploy package with:

```shell
$ npm run deploy [<newversion> | major | minor | patch | premajor | preminor | prepatch | prerelease]
```

This should run the following steps:

  - Check if not tracked commits in git
  - Run tests with `npm test`
  - Upgrade version in `package.json`, commit and add tag
  - Publish package in npmjs.com
