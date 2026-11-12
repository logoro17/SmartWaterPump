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
let manualPumpState = false;
let lastDeviceSeen = 0;
let hourlyChart = null;

const $ = (id) => document.getElementById(id);

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ==========================================
// GRAFIK PEMAKAIAN PER JAM (HARI INI)
// ==========================================
function initHourlyChart() {
  const ctx = $("hourlyChart").getContext("2d");
  const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

  hourlyChart = new window.Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Energi (Wh)",
        data: new Array(24).fill(0),
        backgroundColor: "rgba(56, 189, 248, 0.75)",
        borderColor: "#38bdf8",
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const sec = item.chart.$hourlySec?.[item.dataIndex] ?? 0;
              return [`Energi: ${Number(item.raw).toFixed(4)} Wh`, `Durasi: ${sec} s`];
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#94a3b8", maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(51, 65, 85, 0.5)" }
        }
      }
    }
  });
}

function updateHourlyChart(logs) {
  if (!hourlyChart) initHourlyChart();
  const today = getTodayDateString();
  const hourlyWh = new Array(24).fill(0);
  const hourlySec = new Array(24).fill(0);
  let todayTotalWh = 0;

  logs.forEach((l) => {
    if (!l.startTime || !l.startTime.startsWith(today)) return;
    const hour = parseInt(l.startTime.slice(11, 13), 10);
    if (Number.isNaN(hour) || hour < 0 || hour > 23) return;
    const wh = Number(l.energyWh ?? 0);
    hourlyWh[hour] += wh;
    hourlySec[hour] += Number(l.durationSec ?? 0);
    todayTotalWh += wh;
  });

  hourlyChart.$hourlySec = hourlySec;
  hourlyChart.data.datasets[0].data = hourlyWh;
  hourlyChart.update();
  $("todaySummary").textContent = `Hari ini: ${todayTotalWh.toFixed(3)} Wh`;
}

initHourlyChart();

// ==========================================
// MODAL SETTINGS & SU AUTHENTICATION
// ==========================================
$("btnSettings").onclick = () => $("settingsModal").classList.remove("hidden");
$("btnCloseSettings").onclick = () => $("settingsModal").classList.add("hidden");
$("settingsModal").onclick = (e) => {
  if (e.target === $("settingsModal")) $("settingsModal").classList.add("hidden");
};

function updateControlButtons() {
  const isSU = Boolean(currentUser);

  const btnMode = $("btnToggleMode");
  if (currentMode === "MANUAL") {
    btnMode.textContent = "MANUAL";
    btnMode.className = "btn btn-full btn-warn su-only";
  } else {
    btnMode.textContent = "AUTO";
    btnMode.className = "btn btn-full btn-primary su-only";
  }
  btnMode.disabled = !isSU;

  const btnPump = $("btnTogglePump");
  if (currentMode !== "MANUAL") {
    btnPump.textContent = "Ubah ke MANUAL untuk kontrol";
    btnPump.className = "btn btn-full su-only";
    btnPump.disabled = true;
  } else if (manualPumpState) {
    btnPump.textContent = "⏹ Matikan Pompa";
    btnPump.className = "btn btn-full btn-danger su-only";
    btnPump.disabled = !isSU;
  } else {
    btnPump.textContent = "▶ Hidupkan Pompa";
    btnPump.className = "btn btn-full btn-success su-only";
    btnPump.disabled = !isSU;
  }
}

function applyAuthUI(user) {
  currentUser = user;
  const isSU = Boolean(user);

  $("btnAuthModal").classList.toggle("hidden", isSU);
  $("btnLogout").classList.toggle("hidden", !isSU);
  $("userInfo").classList.toggle("hidden", !isSU);
  $("ctrlLockTag").classList.toggle("hidden", isSU);
  $("cfgLockTag").classList.toggle("hidden", isSU);
  if (isSU) $("userInfo").textContent = `SU: ${user.email}`;

  document.querySelectorAll(".su-only").forEach((el) => (el.disabled = !isSU));
  document.querySelectorAll("#configForm input").forEach((el) => (el.disabled = !isSU));
  updateControlButtons();
}

onAuthStateChanged(auth, applyAuthUI);

$("btnAuthModal").onclick = () => $("authModal").classList.remove("hidden");
$("btnCloseModal").onclick = () => {
  $("authModal").classList.add("hidden");
  $("loginErr").classList.add("hidden");
};
$("authModal").onclick = (e) => {
  if (e.target === $("authModal")) {
    $("authModal").classList.add("hidden");
    $("loginErr").classList.add("hidden");
  }
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
  $("sessionDurVal").textContent = `${s.currentSessionSec ?? 0} s`;

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

  updateControlButtons();
});

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
  manualPumpState = Boolean(ctrl.manualPump);
  updateControlButtons();
});

// ==========================================
// AKSI SU (TOGGLE 1 TOMBOL & CONFIG)
// ==========================================
$("btnToggleMode").onclick = () => {
  if (!currentUser) return;
  const nextMode = currentMode === "AUTO" ? "MANUAL" : "AUTO";
  update(ref(db, "remote/control"), {
    mode: nextMode,
    manualPump: false
  });
};

$("btnTogglePump").onclick = () => {
  if (!currentUser || currentMode !== "MANUAL") return;
  set(ref(db, "remote/control/manualPump"), !manualPumpState);
};

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
  $("settingsModal").classList.add("hidden");
  alert("Parameter berhasil dikirim ke ESP32!");
};

// ==========================================
// LOGS POMPA & UPDATE GRAFIK
// ==========================================
onValue(query(ref(db, "logs"), limitToLast(200)), (snap) => {
  const tbody = $("logsBody");
  if (!snap.exists()) {
    tbody.innerHTML = '<tr><td colspan="5" class="center">Belum ada log aktivitas.</td></tr>';
    updateHourlyChart([]);
    return;
  }

  const allItems = [];
  snap.forEach((child) => allItems.push(child.val()));

  updateHourlyChart(allItems);

  const latest30 = allItems.slice(-30).reverse();
  tbody.innerHTML = latest30.map((l) => `
    <tr>
      <td>${l.startTime || "-"}</td>
      <td>${l.endTime || "-"}</td>
      <td>${l.durationSec ?? 0} s</td>
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