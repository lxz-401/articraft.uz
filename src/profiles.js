const fs = require('fs');
const path = require('path');

const profilesFilePath = path.join(__dirname, '..', 'profiles.json');

// Default profiles based on the user's existing bots config
const defaultProfiles = [
  {
    id: "main_panel",
    name: "Main Panel Bot",
    role: "panel",
    host: process.env.MC_HOST || "articraft.uz",
    port: 25565,
    username: process.env.MC_USERNAME || "ArticraftBot",
    password: process.env.MC_PASSWORD || "",
    version: process.env.MC_VERSION || "1.21.1",
    auth: "offline",
    autoLogin: true,
    autoReconnect: true,
    reconnectDelayMs: 5000,
    webPort: 3000,
    viewerPort: 3007,
    viewerEnabled: true,
    enabled: true
  },
  {
    id: "cocoa_harvester",
    name: "Cocoa Harvester",
    role: "harvester",
    host: process.env.MC_HOST || "articraft.uz",
    port: 25565,
    username: "l0rd1x",
    password: process.env.MC_PASSWORD || "",
    version: process.env.MC_VERSION || "1.21.1",
    auth: "offline",
    autoLogin: true,
    autoReconnect: true,
    reconnectDelayMs: 5000,
    webPort: 3008,
    enabled: true
  },
  {
    id: "cocoa_planter",
    name: "Cocoa Planter",
    role: "planter",
    host: process.env.MC_HOST || "articraft.uz",
    port: 25565,
    username: "lord1x",
    password: process.env.MC_PASSWORD || "",
    version: process.env.MC_VERSION || "1.21.1",
    auth: "offline",
    autoLogin: true,
    autoReconnect: true,
    reconnectDelayMs: 5000,
    webPort: 3009,
    enabled: true
  },
  {
    id: "seller_farmer",
    name: "Seller Farmer",
    role: "farmer",
    host: process.env.MC_HOST || "articraft.uz",
    port: 25565,
    username: "lxz_401",
    password: process.env.MC_PASSWORD || "",
    version: process.env.MC_VERSION || "1.21.1",
    auth: "offline",
    autoLogin: true,
    autoReconnect: true,
    reconnectDelayMs: 5000,
    webPort: 3010,
    enabled: true
  }
];

function loadProfiles() {
  try {
    if (fs.existsSync(profilesFilePath)) {
      const data = fs.readFileSync(profilesFilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`[Profiles] Error reading profiles: ${error.message}`);
  }
  // Initialize with defaults if file doesn't exist
  saveProfiles(defaultProfiles);
  return defaultProfiles;
}

function saveProfiles(profiles) {
  try {
    fs.writeFileSync(profilesFilePath, JSON.stringify(profiles, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`[Profiles] Error saving profiles: ${error.message}`);
    return false;
  }
}

function getProfile(id) {
  const profiles = loadProfiles();
  return profiles.find(p => p.id === id) || null;
}

function addProfile(profile) {
  const profiles = loadProfiles();
  if (profiles.some(p => p.id === profile.id)) {
    return false; // Already exists
  }
  profiles.push(profile);
  saveProfiles(profiles);
  return true;
}

function updateProfile(id, updatedFields) {
  const profiles = loadProfiles();
  const index = profiles.findIndex(p => p.id === id);
  if (index === -1) return false;

  profiles[index] = { ...profiles[index], ...updatedFields };
  saveProfiles(profiles);
  return true;
}

function deleteProfile(id) {
  const profiles = loadProfiles();
  const filtered = profiles.filter(p => p.id !== id);
  if (filtered.length === profiles.length) return false;

  saveProfiles(filtered);
  return true;
}

module.exports = {
  loadProfiles,
  saveProfiles,
  getProfile,
  addProfile,
  updateProfile,
  deleteProfile
};
