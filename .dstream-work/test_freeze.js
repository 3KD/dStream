const assert = require("assert");

function test() {
    try {
        const hls = { config: Object.freeze({ existing: true }) };
        hls.config.p2pSwarm = "test";
        console.log("Success");
    } catch(e) {
        console.log("Error:", e.message);
    }
}
test();
