/**
 * Documentation: http://docs.azk.io/Azkfile.js
 */

// Adds the systems that shape your system
systems({
  'asana-pivotal': {
    // Dependent systems
    depends: [],
    // More images:  http://images.azk.io
    image: {"docker": "azukiapp/node:0.12"},
    // Steps to execute before running instances
    provision: [
      "npm install",
    ],
    workdir: "/azk/#{manifest.dir}",
    shell: "/bin/bash",
    command: "npm start",
    wait: {"retry": 20, "timeout": 1000},
    mounts: {
      '/azk/#{manifest.dir}': path("."),
      '/azk/#{manifest.dir}/node_modules': persistent("#{system.name}-node_modules"),
    },
    scalable: {"default": 1},
    http: {
      domains: [ "#{system.name}.#{azk.default_domain}" ]
    },
    envs: {
      // set instances variables
      NODE_ENV: "dev",
      PATH: "/azk/#{manifest.dir}/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    },
    export_envs: {
      // exports variables for dependent systems
      APP_URL: "#{system.name}.#{azk.default_domain}:#{net.port.http}",
    },
  },

  ngrok: {
    // Dependent systems
    depends: [ 'asana-pivotal' ],
    image : { docker: "azukiapp/ngrok" },
    // not expect application response
    wait: {"retry": 20, "timeout": 1000},
    http: {
      domains: [ "#{manifest.dir}-#{system.name}.#{azk.default_domain}" ],
    },
    ports: {
      http: "4040"
    },
    envs : {
      NGROK_CONFIG: "/ngrok/ngrok.yml",
      NGROK_LOG   : "/tmp/ngrok.log",
    }
  }
});
