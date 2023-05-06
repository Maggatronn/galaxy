export { initAudio, getDeviceNames, createVoice };

var audioCtx = null;

async function setupAudioDevice(ctx, deviceName) {
  const devs = await navigator.mediaDevices.enumerateDevices();
  for (const d of devs) {
    if (d.kind == "audiooutput" && d.label == deviceName) {
      await ctx.setSinkId(d.deviceId);
      console.log("Audio device set to \"" + deviceName + "\"")
      // set output to 6 channels if possible, for 5.1
      // as of 2023.05.02, chrome and firefox don't seem to work with more
      // than 6 channels, but safari works. Probably not too terrible if the
      // top channels don't work for this, and it simplifies the panning
      const nChans = Math.min(ctx.destination.maxChannelCount, 6);
      ctx.destination.channelCount = nChans;
      console.log("Using " + nChans + " of " + ctx.destination.maxChannelCount + " available channels")
      return;
    }
  }
  throw Error("Audio Device \"" + deviceName + "\" not found");
}

// Note that this function needs to be called AFTER the user has interacted
// with the page, so it should be triggered from a button or something.
async function initAudio(deviceName) {
  // need to get permissions if we haven't already, to access all the devices
  await navigator.mediaDevices.getUserMedia({ audio: true });
  if (audioCtx) { console.warn("initAudio called multiple times, can't guarantee everything will get cleaned up"); }
  audioCtx = new AudioContext();
  setupAudioDevice(audioCtx, deviceName);
}

async function getDeviceNames() {
  // need to get permissions in order to see all the devices
  await navigator.mediaDevices.getUserMedia({ audio: true });
  const devs = await navigator.mediaDevices.enumerateDevices();
  // print the device names
  return devs.filter(d => d.kind == "audiooutput").map(d => d.label);
}

function coords_to_string(coords) { return "(" + coords.x + ", " + coords.y + ")" }

function createVoice(url, listenerCoords, voiceCoords) {
  console.log("New voice at " + url)
  console.log("listener coords: " + coords_to_string(listenerCoords))
  console.log("voice coords: " + coords_to_string(voiceCoords))
  const mediaElement = new Audio(url);
  // if we want to load audio from a different host (e.g. running the site from
  // localhost and pulling from LVN), then we need to use CORS, which isn't used
  // unless we set this property
  mediaElement.crossOrigin = "anonymous";
  const elemNode = new MediaElementAudioSourceNode(audioCtx, {mediaElement});
  const panner = createPanner(audioCtx, audioCtx.destination);
  panner.pan = panFromCoords(listenerCoords, voiceCoords);
  // TODO: set gain based on distance
  elemNode.connect(panner.node);
  return {
    set listenerCoords(xy) {
      this._listenerCoords = xy;
      this._panner.pan = panFromCoords(this._listenerCoords, this._voiceCoords);
    },
    set voiceCoords(xy) {
      this._voiceCoords = xy;
      this._panner.pan = panFromCoords(this._listenerCoords, this._voiceCoords);
    },
    pause: () => mediaElement.pause(),
    play: () => mediaElement.play(),
    _elem: mediaElement,
    _elemNode: elemNode,
    _panner: panner,
    _listenerCoords: listenerCoords,
    _voiceCoords: voiceCoords
  }
}

function panFromCoords(listenerCoords, voiceCoords) {
  // coordinates have (0,0) at the top-left and increase down and right
  // TODO
  return 0;
}

function gainFromCoords(listenerCoords, voiceCoords, listenRadius) {
  // TODO
  return 1;
}

/* 
 * Build a multichannel surround panner.
 */
function createPanner(ctx, destNode) {
  const nChans = destNode.channelCount;
  const merger = new ChannelMergerNode(ctx, {numberOfInputs: nChans});
  merger.connect(ctx.destination);
  // the fanout node is responsible for sending its input to all the separate
  // per-channel gain nodes. We force it to be mono so that any inputs will get
  // downmixed before we fan-out to the output channels. If we wanted to be
  // fancier we could handle a full mix matrix to pan/balance multichannel
  // signals, but not for now
  const fanout = new GainNode(ctx, {gain: 1, channelCount: 1, channelCountMode: "explicit"});
  // create 1 gain node for each channel
  const channelGains = []
  for(let i = 0; i < nChans; ++i) {
  	const g = new GainNode(ctx, {gain: 0});
    /////////
    // TEMPORARY - set gain to pass-through until we can actually pan
    g.gain.value = 1;
    /////////
    channelGains.push(g);
    g.connect(merger, 0, i);
    fanout.connect(g);
  }
  // keep references to all the nodes here, just to protect from garbage collection.
  // we expect users to only interact with `node` and the `pan` function.
  return {
    node: fanout,
    merger,
    channelGains,
    set pan(p) {
      // TODO: set the channel gains based on the pan direction here
    }
  }
}