#!/bin/sh
# The page loads three.js 0.160 from jsDelivr; the test tools serve this copy instead of the network.
curl -fsSL -o three.module.js https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js
