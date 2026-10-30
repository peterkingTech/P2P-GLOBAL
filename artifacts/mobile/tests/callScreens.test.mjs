// Call screens — which UI is shown when (source checks; the screens need a
// device + Agora to run, which these can't provide):
//   • ringing (app/call/incoming.tsx, Android IncomingCallActivity.kt,
//     iOS CallKit) always carries P2P Global branding, the caller's real
//     photo and name, and the unchanged Answer/Decline;
//   • an answered AUDIO call shows the voice layout only — chosen by the
//     explicit callType, never by whether a photo / remote video exists;
//   • an answered VIDEO call keeps the full video experience.
// Run: node tests/callScreens.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
// JSX between an opening marker and the next closing marker, for scoping.
const between = (s, from, to) => { const i = s.indexOf(from); return i < 0 ? "" : s.slice(i, s.indexOf(to, i + from.length)); };

// ── Ringing ─────────────────────────────────────────────────────────────
const inc = src("app/call/incoming.tsx");
ok("ringing: P2P logo + name in a brand bar at the top", /const LOGO = require\("@\/assets\/images\/logo\.png"\)/.test(inc)
  && /styles\.brandBar[\s\S]{0,300}source=\{LOGO\}[\s\S]{0,200}>P2P Global<\/Text>/.test(inc));
ok("ringing: brand bar sits above the caller's name", inc.indexOf("styles.brandBar") > 0 && inc.indexOf("styles.brandBar") < inc.indexOf("styles.callerName}"));
ok("ringing: caller's real photo (usePeerPhoto) fills the screen, Avatar fallback", /usePeerPhoto\(params\.callerId, params\.callerPhotoUrl\)/.test(inc)
  && /source=\{\{ uri: callerPhotoUrl \}\}\s*\n\s*style=\{StyleSheet\.absoluteFill\}/.test(inc) && /<Avatar name=\{callerName\}/.test(inc));
ok("ringing: Decline hidden only for crisis; Accept always", /\{!isCrisis && \(/.test(inc) && /accessibilityLabel="Accept call"/.test(inc) && /accessibilityLabel="Decline call"/.test(inc));
ok("ringing: answer routes by explicit call type", (inc.match(/=== "video" \? "\/call\/video" : "\/call\/audio"/g) ?? []).length === 2);

const kt = src("modules/call-system/android/src/main/java/expo/modules/p2pcallsystem/IncomingCallActivity.kt");
ok("Android ringer: brand bar with the app's own icon + \"P2P Global\" above the name",
  /applicationInfo\.loadIcon\(packageManager\)/.test(kt) && /text = "P2P Global"/.test(kt) && kt.indexOf('text = "P2P Global"') < kt.search(/text = call\.peerName\s*$/m));
ok("Android ringer: icon lookup can't crash the ringer", /runCatching \{ applicationInfo\.loadIcon\(packageManager\) \}\.getOrNull\(\)/.test(kt));
ok("Android ringer: photo, name, Decline/Accept unchanged", /CallPhotoCache\.load/.test(kt) && /callButton\("Decline"/.test(kt) && /callButton\("Accept"/.test(kt));

const ck = src("modules/call-system/ios/CallKitManager.swift");
ok("iOS CallKit: P2P mark as the system call screen's template icon", /config\.iconTemplateImageData = Self\.brandTemplateIcon\(\)/.test(ck) && /let text = "P2P" as NSString/.test(ck));
ok("iOS: UIKit imported + linked for the icon", /^import UIKit$/m.test(ck) && /'UIKit'/.test(src("modules/call-system/ios/P2PCallSystem.podspec")));

// ── Answered audio call ─────────────────────────────────────────────────
const aud = src("app/call/audio.tsx");
ok("1:1 audio still uses the ONE shared call engine screen (no second engine)", /if \(params\.callType === "audio" && params\.otherUserId\) return <VideoCallScreen \/>;/.test(aud));
ok("pastoral/group audio screen: no full-screen photo backdrop", !/style=\{StyleSheet\.absoluteFill\}\s*\n\s*contentFit="cover"\s*\n\s*blurRadius/.test(aud) && !/backdropShade/.test(aud));

const vid = src("app/call/video.tsx");
ok("screen chosen by explicit callType; voice layout while the audio call is still audio on both sides", /const startsAsAudio = params\.callType === "audio";/.test(vid)
  && /const isAudioCall = startsAsAudio && mediaMode === "audio" && !remoteUids\.some\(\(uid\) => !!remoteVideoOn\[uid\]\);/.test(vid)
  && /const callTypeForRecord: "audio" \| "video" = startsAsAudio \? "audio" : "video";/.test(vid) && /callAgainIcon=\{startsAsAudio \? "call" : "videocam"\}/.test(vid));
ok("audio call: voice layout for 1:1 regardless of remote video", /const audioPresentation = remoteUids\.length <= 1 && \(isAudioCall \|\| \(mediaMode === "audio" && !anyRemoteVideo\)\);/.test(vid));
ok("audio call: blurred full-screen photo only for VIDEO calls", /\{peerPhotoUrl && !isAudioCall && \(\s*\n\s*<ExpoImage[\s\S]{0,300}blurRadius=\{40\}/.test(vid));
ok("audio call: never renders a video tile (remote or self)", /videoOn: !isAudioCall && !!remoteVideoOn\[uid\]/.test(vid) && /videoOn: !isAudioCall && cameraOn && localJoined/.test(vid));
ok("every 1:1 call (audio or video) has the Audio/Video switch", /\{\/\* Every 1:1 call, audio or video, can switch\. \*\/\}\s*\n\s*<P2PControlButton\s*\n\s*size=\{controlSize\}\s*\n\s*onPress=\{mediaMode === "video" \? switchToAudioMode : switchToVideoMode\}/.test(vid)
  && /accessibilityLabel=\{mediaMode === "video" \? "Switch to audio" : "Switch to video"\}/.test(vid));
ok("switching never leaves the call (camera on/off only; permission asked on first switch to video)", /function switchToAudioMode\(\)[\s\S]{0,300}enableLocalVideo\(false\)/.test(vid) && /async function switchToVideoMode\(\)[\s\S]{0,1200}ensureCameraReady\(\)[\s\S]{0,600}enableLocalVideo\(true\)/.test(vid)
  && !/function switchTo(Audio|Video)Mode[\s\S]{0,1500}(leaveChannel|joinChannel)/.test(vid));
ok("audio call: no camera / flip / smoothing / blur", /\{!isAudioCall && mediaMode === "video" && \(\s*\n\s*<P2PControlButton\s*\n\s*size=\{controlSize\}\s*\n\s*onPress=\{toggleCamera\}/.test(vid)
  && /\{!isAudioCall && mediaMode === "video" && \(\s*\n\s*<P2PControlButton size=\{controlSize\} onPress=\{flipCamera\}/.test(vid)
  && /\{!isAudioCall && cameraOn && mediaMode === "video" && \(/.test(vid) && /\.\.\.\(!isAudioCall && mediaMode === "video" && cameraOn/.test(vid));
const strip = between(vid, "const participantStrip = (", "\n  );");
ok("audio call: Study Together strip has no camera button or video", /\{!isAudioCall && \(\s*\n\s*<TouchableOpacity[^>\n]*style=\{styles\.studyMiniBtn\} onPress=\{toggleCamera\}>/.test(strip)
  && /remoteUid !== null && !isAudioCall \? <RtcSurfaceView/.test(strip) && /\{!isAudioCall && cameraOn && localJoined && \(/.test(strip));
ok("audio mode: 5 controls — Speaker, Switch to video, Mute, More, End", /controlSizeFor\(mediaMode === "video" \? 7 : 5\)/.test(vid)
  && /onPress=\{toggleSpeaker\}/.test(vid) && /onPress=\{toggleMute\} active=\{muted\}/.test(vid) && /accessibilityLabel="More call options"/.test(vid) && /danger accessibilityLabel="End call"/.test(vid));
ok("audio call: avatar + name + elapsed time", /isAudioCall && callState === "connected" && \(\s*\n\s*<Text style=\{styles\.peerElapsed\}/.test(vid) && /<Avatar name=\{otherName\} size=\{portraitSize\} \/>/.test(vid));
ok("audio call: no camera-unavailable banner", /\{cameraUnavailable && !isAudioCall && \(/.test(vid));

// ── Answered video call: unchanged ───────────────────────────────────────
ok("video call: rect video stage still used when not audio", /<P2PRectStage\s*\n\s*tiles=\{allTiles\}/.test(vid));
ok("video call: still starts with camera on, publishes video", /useState\(!startsAsAudio\)/.test(vid) && /initialPublishVideo: startsAsAudio \? false : !isInitiator/.test(vid));
ok("video call: its own Audio/Video switch kept", /switchToAudioMode\(\)/.test(vid) && /async function switchToVideoMode\(\)/.test(vid));

// ── Engine untouched ───────────────────────────────────────────────────
ok("Agora engine settings untouched (enableVideo, startWithCameraOff)", /enableVideo: true,/.test(vid) && /startWithCameraOff: startsAsAudio,/.test(vid));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
