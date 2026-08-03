import assert from "node:assert/strict";
import type { NetworkInterfaceInfo } from "node:os";
import test from "node:test";
import { selectNetworkDetails } from "./systemOverview";

const virtualAdapter: NetworkInterfaceInfo = { address: "10.5.0.2", netmask: "255.255.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: "10.5.0.2/16" };
const wifiAdapter: NetworkInterfaceInfo = { address: "192.168.1.118", netmask: "255.255.255.0", family: "IPv4", mac: "a8:41:f4:e7:0e:5b", internal: false, cidr: "192.168.1.118/24" };

test("system overview skips virtual adapters with all-zero MAC addresses", () => {
  assert.deepEqual(selectNetworkDetails({ NordLynx: [virtualAdapter], "Wi-Fi": [wifiAdapter] }), { ipAddress: "192.168.1.118", macAddress: "A8:41:F4:E7:0E:5B" });
});

test("system overview does not display an invalid MAC address", () => {
  assert.deepEqual(selectNetworkDetails({ NordLynx: [virtualAdapter] }), { ipAddress: "10.5.0.2", macAddress: "Not Available" });
});