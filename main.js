import './style.css';

import firebase from 'firebase/app';
import 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDA4d3hwVtD_f5HURofsvVcFrYIHxfRbQg",
  authDomain: "fireside-47bb3.firebaseapp.com",
  projectId: "fireside-47bb3",
  storageBucket: "fireside-47bb3.appspot.com",
  messagingSenderId: "536421323037",
  appId: "1:536421323037:web:4fe1bf2635a8effdf051f4"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');
const muteAudioButton = document.getElementById('muteAudioButton');
const disableVideoButton = document.getElementById('disableVideoButton');
const cameraSelect = document.getElementById('cameraSelect');

// Global state for tracking mute and video states
let isAudioMuted = false;
let isVideoDisabled = false;

// Function to populate camera options
async function populateCameraOptions() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(device => device.kind === 'videoinput');
  
  cameraSelect.innerHTML = '';
  videoDevices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.text = device.label || `Camera ${cameraSelect.length + 1}`;
    cameraSelect.appendChild(option);
  });
}

// Function to start the webcam
async function startWebcam() {
  const selectedCameraId = cameraSelect.value;
  const constraints = {
    video: { deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined },
    audio: true
  };

  try {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    remoteStream = new MediaStream();

    // Push tracks from local stream to peer connection
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    // Pull tracks from remote stream, add to video stream
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
    };

    webcamVideo.srcObject = localStream;
    remoteVideo.srcObject = remoteStream;

    callButton.disabled = false;
    answerButton.disabled = false;
    muteAudioButton.disabled = false;
    disableVideoButton.disabled = false;
  } catch (error) {
    console.error('Error accessing media devices.', error);
  }
}

// 1. Setup media sources
webcamButton.onclick = async () => {
  await populateCameraOptions();
  await startWebcam();
  webcamButton.disabled = true;
};

// Add camera switch functionality
cameraSelect.onchange = async () => {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  await startWebcam();
};

// Add mute audio functionality
muteAudioButton.onclick = () => {
  isAudioMuted = !isAudioMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isAudioMuted;
  });
  muteAudioButton.textContent = isAudioMuted ? 'Unmute Audio' : 'Mute Audio';
};

// Add disable video functionality
disableVideoButton.onclick = () => {
  isVideoDisabled = !isVideoDisabled;
  localStream.getVideoTracks().forEach(track => {
    track.enabled = !isVideoDisabled;
  });
  disableVideoButton.textContent = isVideoDisabled ? 'Enable Video' : 'Disable Video';
};

// 2. Create an offer
callButton.onclick = async () => {
  // Reference Firestore collections for signaling
  const callDoc = firestore.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  callInput.value = callDoc.id;

  // Get candidates for caller, save to db
  pc.onicecandidate = (event) => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });

  // Listen for remote answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  hangupButton.disabled = false;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
};

// 4. Hangup call
hangupButton.onclick = () => {
  // Stop all tracks on the local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  // Close the peer connection
  if (pc) {
    pc.close();
  }

  // Reset UI elements
  webcamVideo.srcObject = null;
  remoteVideo.srcObject = null;
  webcamButton.disabled = false;
  callButton.disabled = true;
  answerButton.disabled = true;
  hangupButton.disabled = true;
  muteAudioButton.disabled = true;
  disableVideoButton.disabled = true;

  // Reset global variables
  localStream = null;
  remoteStream = null;
  isAudioMuted = false;
  isVideoDisabled = false;

  // Reset button texts
  muteAudioButton.textContent = 'Mute Audio';
  disableVideoButton.textContent = 'Disable Video';
};