import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, update, set, remove, query, limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ==========================================
// KONFIGURASI FIREBASE PROJECT KAMU
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAVuIEcatcoco_14NuV29Muff2OVmPIcGE",
  authDomain: "smartwaterpump-a1283.firebaseapp.com",
  databaseURL: "https://smartwaterpump-a1283-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "smartwaterpump-a1283",
  storageBucket: "smartwaterpump-a1283.firebasestorage.app",
  messagingSenderId: "679450097583",
  appId: "1:679450097583:web:1af29c65d8ef0439a8e15a",
  measurementId: "G-77CYW9GNVH"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

let currentUser = null;
let currentMode = "AUTO";
let lastDeviceSeen = 0;

const $ = (id) => document.getElementById(id);

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

// ==========================================
// SUPERUSER AUTHENTICATION
// ==========================================
function applyAuthUI(user) {
  currentUser = user;
  const isSU = Boolean(user);

  $("btnAuthModal").classList.toggle("hidden", isSU);
  $("btnLogout").classList.toggle("hidden", !isSU);
  $("userInfo").classList.toggle("hidden", !isSU);
  $("ctrlLockTag").classList.toggle("hidden", isSU);
  $("cfgLockTag").classList.toggle("hidden", isSU);
  if (isSU) $("userInfo").textContent = `SuperUser: ${user.email}`;

  document.querySelectorAll(".su-only").forEach((el) => (el.disabled = !isSU));
  document.querySelectorAll("#configForm input").forEach((el) => (el.disabled = !isSU));
  updateManualButtons();
}

function updateManualButtons() {
  const canManual = Boolean(currentUser) && currentMode === "MANUAL";
  $("btnPumpOn").disabled = !canManual;
  $("btnPumpOff").disabled = !canManual;
}

onAuthStateChanged(auth, applyAuthUI);

$("btnAuthModal").onclick = () => $("authModal").classList.remove("hidden");
$("btnCloseModal").onclick = () => {
  $("authModal").classList.add("hidden");
  $("loginErr").classList.add("hidden");
};

$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await signInWithEmailAndPassword(auth, $("loginEmail").value, $("loginPass").value);
    $("authModal").classList.add("hidden");
    $("loginForm").reset();
    $("loginErr").classList.add("hidden");
  } catch (err) {
    $("loginErr").textContent = "Login gagal: " + err.message;
    $("loginErr").classList.remove("hidden");
  }
};

$("btnLogout").onclick = () => signOut(auth);

// ==========================================
// REALTIME LISTENERS: STATUS
// ==========================================
onValue(ref(db, "status"), (snap) => {
  const s = snap.val();
  if (!s) return;

  lastDeviceSeen = Date.now();
  $("connBadge").textContent = "Device Online";
  $("connBadge").className = "badge online";

  const pct = s.waterPercent ?? 0;
  $("tankWater").style.height = `${pct}%`;
  $("tankPctText").textContent = `${pct}%`;
  $("rawAdcVal").textContent = s.rawAdc ?? "-";

  $("pumpStateBadge").textContent = s.isPumpOn ? "HIDUP" : "MATI";
  $("pumpStateBadge").className = `badge ${s.isPumpOn ? "on" : "off"}`;

  currentMode = s.mode || "AUTO";
  $("modeBadge").textContent = currentMode;
  $("flowVal").textContent = s.flowPulses ?? 0;
  $("sessionDurVal").textContent = `${s.currentSessionSec ?? 0} dtk`;

  if (s.isWaterEmpty) {
    $("emptyAlert").classList.remove("hidden");
    $("retryVal").textContent = s.retryCountdown ?? 0;
  } else {
    $("emptyAlert").classList.add("hidden");
  }

  const wh = Number(s.totalEnergyWh ?? 0);
  $("totalEnergyWh").textContent = wh.toFixed(3);
  $("totalEnergyKwh").textContent = `${(wh / 1000).toFixed(4)} kWh`;
  $("currentWattsVal").textContent = `${Number(s.currentWatts ?? 0).toFixed(2)} W`;
  $("totalRuntimeVal").textContent = formatDuration(s.totalRuntimeSec ?? 0);

  updateManualButtons();
});

// Cek apakah ESP32 berhenti mengirim update (>10 detik)
setInterval(() => {
  if (lastDeviceSeen > 0 && Date.now() - lastDeviceSeen > 10000) {
    $("connBadge").textContent = "Device Offline";
    $("connBadge").className = "badge offline";
  }
}, 3000);

// ==========================================
// REALTIME LISTENERS: CONFIG & CONTROL
// ==========================================
onValue(ref(db, "remote/config"), (snap) => {
  const c = snap.val();
  if (!c) return;
  $("cfgLowTxt").textContent = `${c.levelLowPercent}%`;
  $("cfgHighTxt").textContent = `${c.levelHighPercent}%`;

  // Jangan timpa input jika sedang fokus mengetik
  if (document.activeElement?.closest("#configForm")) return;
  $("inLow").value = c.levelLowPercent ?? 30;
  $("inHigh").value = c.levelHighPercent ?? 95;
  $("inStep").value = c.flowStepTime ?? 20000;
  $("inRetry").value = c.retryInterval ?? 60000;
  $("inMinFlow").value = c.minFlowPulses ?? 1;
  $("inAdcMin").value = c.adcMinVal ?? 2300;
  $("inAdcMax").value = c.adcMaxVal ?? 3800;
  $("inPwm").value = c.pumpPower ?? 200;
  $("inWatts").value = c.pumpRatedWatts ?? 5.0;
});

onValue(ref(db, "remote/control"), (snap) => {
  const ctrl = snap.val();
  if (!ctrl) return;
  currentMode = ctrl.mode || "AUTO";
  $("btnModeAuto").classList.toggle("active", currentMode === "AUTO");
  $("btnModeManual").classList.toggle("active", currentMode === "MANUAL");
  updateManualButtons();
});

// ==========================================
// AKSI SUPERUSER (KONTROL & SIMPAN PARAMETER)
// ==========================================
$("btnModeAuto").onclick = () => update(ref(db, "remote/control"), { mode: "AUTO", manualPump: false });
$("btnModeManual").onclick = () => update(ref(db, "remote/control"), { mode: "MANUAL" });
$("btnPumpOn").onclick = () => set(ref(db, "remote/control/manualPump"), true);
$("btnPumpOff").onclick = () => set(ref(db, "remote/control/manualPump"), false);

$("btnResetEnergy").onclick = () => {
  if (confirm("Reset counter total pemakaian daya & waktu nyala?")) {
    set(ref(db, "remote/control/resetEnergyCmd"), true);
  }
};

$("configForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  await update(ref(db, "remote/config"), {
    levelLowPercent: Number($("inLow").value),
    levelHighPercent: Number($("inHigh").value),
    flowStepTime: Number($("inStep").value),
    retryInterval: Number($("inRetry").value),
    minFlowPulses: Number($("inMinFlow").value),
    adcMinVal: Number($("inAdcMin").value),
    adcMaxVal: Number($("inAdcMax").value),
    pumpPower: Number($("inPwm").value),
    pumpRatedWatts: Number($("inWatts").value),
    updatedBy: "web"
  });
  alert("Parameter berhasil dikirim ke ESP32!");
};

// ==========================================
// LOGS POMPA
// ==========================================
onValue(query(ref(db, "logs"), limitToLast(30)), (snap) => {
  const tbody = $("logsBody");
  if (!snap.exists()) {
    tbody.innerHTML = '<tr><td colspan="5" class="center">Belum ada log aktivitas.</td></tr>';
    return;
  }
  const items = [];
  snap.forEach((child) => items.push(child.val()));
  items.reverse(); // Terbaru di atas

  tbody.innerHTML = items.map((l) => `
    <tr>
      <td>${l.startTime || "-"}</td>
      <td>${l.endTime || "-"}</td>
      <td>${l.durationSec ?? 0} dtk</td>
      <td>${Number(l.energyWh ?? 0).toFixed(4)}</td>
      <td>${l.stopReason || "-"}</td>
    </tr>
  `).join("");
});

$("btnClearLogs").onclick = () => {
  if (confirm("Hapus seluruh riwayat log pompa di Firebase?")) {
    remove(ref(db, "logs"));
  }
};