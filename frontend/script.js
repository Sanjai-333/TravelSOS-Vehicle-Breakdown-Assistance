
const API_BASE = "http://127.0.0.1:8000/api";

let breakdownChartInstance = null;
let problemChartInstance = null;

// --------------------------------------------------
// COMMON API FUNCTION
// Avoid unnecessary CORS preflight requests.
// --------------------------------------------------

async function apiRequest(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
    }

    return response.json();
}

// --------------------------------------------------
// COMMON HELPERS
// --------------------------------------------------

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function formatCurrency(value) {
    const amount = Number(value);
    return Number.isFinite(amount)
        ? "₹" + amount.toLocaleString("en-IN")
        : "N/A";
}

function showMessage(elementId, message, isError = false) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.textContent = message;
    element.style.color = isError ? "#b42318" : "#087e73";
}

function setText(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) element.textContent = value ?? 0;
}

function getUrgencyClass(urgency) {
    const value = String(urgency ?? "").toLowerCase();

    if (value === "critical") return "status-danger";
    if (value === "high") return "status-warning";

    return "";
}

function getUrgencyLabel(urgency) {
    return `<span class="status-badge ${getUrgencyClass(urgency)}">${escapeHTML(urgency || "Normal")}</span>`;
}

function extractList(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.records)) return data.records;
    if (Array.isArray(data?.mechanics)) return data.mechanics;
    if (Array.isArray(data?.breakdowns)) return data.breakdowns;

    return [];
}

// --------------------------------------------------
// API CONNECTION STATUS
// --------------------------------------------------

async function checkConnection() {
    const sidebarStatus = document.getElementById("connectionStatus");
    const dashboardStatus = document.getElementById("apiStatus");
    const recordsStatus = document.getElementById("recordsStatus");

    try {
        await apiRequest("/status");

        if (sidebarStatus) {
            sidebarStatus.textContent = "R API connected successfully";
        }

        if (dashboardStatus) {
            dashboardStatus.textContent = "Connected";
            dashboardStatus.style.color = "#0f9488";
        }

        if (recordsStatus) {
            recordsStatus.textContent = "Connected";
            recordsStatus.style.color = "#0f9488";
        }

        return true;
    } catch (error) {
        console.error("API connection error:", error);

        if (sidebarStatus) sidebarStatus.textContent = "API unavailable";
        if (dashboardStatus) {
            dashboardStatus.textContent = "Offline";
            dashboardStatus.style.color = "#d97706";
        }
        if (recordsStatus) {
            recordsStatus.textContent = "Offline";
            recordsStatus.style.color = "#d97706";
        }

        return false;
    }
}

// --------------------------------------------------
// DASHBOARD
// --------------------------------------------------

async function loadDashboard() {
    try {
        const [summary, mechanicsData, breakdownData] = await Promise.all([
            apiRequest("/summary"),
            apiRequest("/mechanics"),
            apiRequest("/breakdowns")
        ]);

        const mechanics = extractList(mechanicsData);
        const breakdowns = extractList(breakdownData);

        setText(
            "totalBreakdowns",
            summary.total_breakdowns ?? summary.totalBreakdowns ?? breakdowns.length
        );

        setText(
            "totalMechanics",
            summary.total_mechanics ?? summary.totalMechanics ?? mechanics.length
        );

        const highPriority = summary.high_priority ??
            summary.highPriority ??
            breakdowns.filter(item =>
                ["high", "critical"].includes(
                    String(item.urgency ?? "").toLowerCase()
                )
            ).length;

        setText("highPriority", highPriority);
        renderCharts(breakdowns);

    } catch (error) {
        console.error("Dashboard loading error:", error);
        showMessage("connectionStatus", "Unable to load dashboard data.", true);
    }
}

// --------------------------------------------------
// CHARTS
// --------------------------------------------------

function countProblems(breakdowns) {
    const counts = {
        Engine: 0,
        Battery: 0,
        Tyre: 0,
        General: 0
    };

    breakdowns.forEach(item => {
        const problem = String(item.problem ?? "General").toLowerCase();

        if (problem.includes("engine")) counts.Engine++;
        else if (problem.includes("battery")) counts.Battery++;
        else if (problem.includes("tyre") || problem.includes("tire")) counts.Tyre++;
        else counts.General++;
    });

    return counts;
}

function renderCharts(breakdowns = []) {
    if (typeof Chart === "undefined") {
        console.warn("Chart.js is not loaded.");
        return;
    }

    const counts = countProblems(breakdowns);
    const colors = ["#14213d", "#14b8a6", "#ff9f43", "#6c8ebf"];

    const barCanvas = document.getElementById("breakdownChart");

    if (barCanvas) {
        if (breakdownChartInstance) breakdownChartInstance.destroy();

        breakdownChartInstance = new Chart(barCanvas, {
            type: "bar",
            data: {
                labels: Object.keys(counts),
                datasets: [{
                    label: "Reported Breakdowns",
                    data: Object.values(counts),
                    backgroundColor: colors,
                    borderRadius: 8,
                    maxBarThickness: 48
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    const doughnutCanvas = document.getElementById("problemChart");

    if (doughnutCanvas) {
        if (problemChartInstance) problemChartInstance.destroy();

        problemChartInstance = new Chart(doughnutCanvas, {
            type: "doughnut",
            data: {
                labels: Object.keys(counts),
                datasets: [{
                    data: Object.values(counts),
                    backgroundColor: colors,
                    borderWidth: 3,
                    borderColor: "#ffffff"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "66%",
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: {
                            usePointStyle: true,
                            padding: 18
                        }
                    }
                }
            }
        });
    }
}

// --------------------------------------------------
// MECHANICS PAGE
// --------------------------------------------------

async function loadMechanics() {
    const tableBody = document.getElementById("mechanicsBody");
    if (!tableBody) return;

    try {
        const data = await apiRequest("/mechanics");
        const mechanics = extractList(data);

        if (!mechanics.length) {
            tableBody.innerHTML = '<tr><td colspan="5">No mechanics available.</td></tr>';
            return;
        }

        tableBody.innerHTML = mechanics.map(mechanic => {
            const name = mechanic.name ?? "Unknown mechanic";
            const speciality = mechanic.speciality ?? mechanic.service ?? "General Repair";
            const distance = mechanic.distance_km ?? mechanic.distance ?? "N/A";
            const rating = mechanic.rating ?? "N/A";
            const cost = mechanic.estimated_cost ?? mechanic.cost;

            return `
                <tr>
                    <td><strong>${escapeHTML(name)}</strong></td>
                    <td>${escapeHTML(speciality)}</td>
                    <td>${escapeHTML(distance)}${Number.isFinite(Number(distance)) ? " km" : ""}</td>
                    <td>⭐ ${escapeHTML(rating)}</td>
                    <td>${cost == null ? "N/A" : formatCurrency(cost)}</td>
                </tr>`;
        }).join("");

    } catch (error) {
        console.error("Mechanics loading error:", error);
        tableBody.innerHTML = '<tr><td colspan="5">Unable to load mechanics.</td></tr>';
    }
}

// --------------------------------------------------
// MECHANIC RECOMMENDATION
// --------------------------------------------------

async function recommendMechanic() {
    const problemElement = document.getElementById("problemFilter");
    const resultElement = document.getElementById("recommendation");

    if (!problemElement || !resultElement) return;

    resultElement.textContent = "Finding a suitable mechanic...";

    try {
        const problem = problemElement.value;
        const data = await apiRequest(
            `/recommend?problem=${encodeURIComponent(problem)}`
        );

        const mechanic = data.recommendation ?? data.mechanic ?? data;

        resultElement.innerHTML = `
            <div class="info-note">
                <strong>Recommended mechanic: ${escapeHTML(mechanic.name ?? "Unknown")}</strong><br>
                Speciality: ${escapeHTML(mechanic.speciality ?? mechanic.service ?? problem)}<br>
                Distance: ${escapeHTML(mechanic.distance_km ?? "N/A")} km<br>
                Rating: ⭐ ${escapeHTML(mechanic.rating ?? "N/A")}<br>
                Estimated cost: ${mechanic.estimated_cost == null ? "N/A" : formatCurrency(mechanic.estimated_cost)}
            </div>`;

    } catch (error) {
        console.error("Recommendation error:", error);
        showMessage("recommendation", "Could not get a mechanic recommendation.", true);
    }
}

// --------------------------------------------------
// BREAKDOWN REPORT FORM
// --------------------------------------------------

function setupBreakdownForm() {
    const form = document.getElementById("breakdownForm");
    if (!form) return;

    form.addEventListener("submit", async function(event) {
        event.preventDefault();

        const vehicle = document.getElementById("vehicle")?.value.trim();
        const problem = document.getElementById("problem")?.value;
        const location = document.getElementById("location")?.value.trim();
        const urgency = document.getElementById("urgency")?.value;

        if (!vehicle || !problem || !location || !urgency) {
            showMessage("formMessage", "Please complete all required fields.", true);
            return;
        }

        const button = form.querySelector('button[type="submit"]');

        if (button) {
            button.disabled = true;
            button.textContent = "Submitting...";
        }

        try {
            // Use URL parameters to match the existing R Plumber endpoint.
            // No custom Content-Type header is needed.
            const params = new URLSearchParams({
                vehicle,
                problem,
                location,
                urgency
            });

            const response = await fetch(
                `${API_BASE}/breakdowns?${params.toString()}`,
                { method: "POST" }
            );

            const responseText = await response.text();
            let result;

            try {
                result = JSON.parse(responseText);
            } catch {
                throw new Error(
                    `The API returned an unexpected response: ${responseText.slice(0, 200)}`
                );
            }

            if (!response.ok || result.success === false) {
                throw new Error(
                    result.message ?? `HTTP error ${response.status}`
                );
            }

            showMessage(
                "formMessage",
                result.message ?? "Breakdown report submitted successfully."
            );

            form.reset();

        } catch (error) {
            console.error("Breakdown submission error:", error);

            showMessage(
                "formMessage",
                `Submission failed: ${error.message}. Check the browser Console.`,
                true
            );
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Submit Breakdown Report →";
            }
        }
    });
}

// --------------------------------------------------
// BREAKDOWN RECORDS PAGE
// --------------------------------------------------

async function loadRecords() {
    const tableBody = document.getElementById("recordsBody");
    if (!tableBody) return;

    try {
        const data = await apiRequest("/breakdowns");
        const records = extractList(data);

        setText("recordCount", records.length);

        const status = document.getElementById("recordsStatus");
        if (status) {
            status.textContent = "Loaded";
            status.style.color = "#0f9488";
        }

        if (!records.length) {
            tableBody.innerHTML = '<tr><td colspan="4">No breakdown reports recorded yet.</td></tr>';
            return;
        }

        tableBody.innerHTML = records.map(record => `
            <tr>
                <td><strong>${escapeHTML(record.vehicle ?? "N/A")}</strong></td>
                <td>${escapeHTML(record.problem ?? "N/A")}</td>
                <td>${escapeHTML(record.location ?? "N/A")}</td>
                <td>${getUrgencyLabel(record.urgency)}</td>
            </tr>
        `).join("");

    } catch (error) {
        console.error("Records loading error:", error);
        setText("recordCount", "—");

        if (document.getElementById("recordsStatus")) {
            document.getElementById("recordsStatus").textContent = "Unavailable";
        }

        tableBody.innerHTML = '<tr><td colspan="4">Unable to load breakdown records.</td></tr>';
    }
}

// --------------------------------------------------
// PAGE INITIALISATION
// --------------------------------------------------

document.addEventListener("DOMContentLoaded", async function() {
    await checkConnection();

    if (document.getElementById("totalBreakdowns")) {
        await loadDashboard();
    }

    if (document.getElementById("mechanicsBody")) {
        await loadMechanics();
    }

    if (document.getElementById("recordsBody")) {
        await loadRecords();
    }

    setupBreakdownForm();
});
