var Utils = {
  verbose: false,

  log: function(...args) {
    if (!!this.verbose) {
      console.log(...args);
    }
  }
};

export default Utils;
