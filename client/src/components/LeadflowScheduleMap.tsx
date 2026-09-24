import { useCallback, useRef } from "react";
import { MapView } from "@/components/Map";

export type LeadflowScheduleMapTeam = {
  id: number;
  name: string;
  color: string | null;
  homeLat: number | null;
  homeLng: number | null;
  isActive: number;
};

export type LeadflowScheduleMapJob = {
  id: number;
  customerName: string | null;
  jobAddress: string | null;
  serviceDateTime: string | null;
  assignment: {
    teamId: number;
    routeOrder: number;
  } | null;
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LeadflowScheduleMap({
  jobs,
  teams,
  selectedJobId,
  onJobSelect,
}: {
  jobs: LeadflowScheduleMapJob[];
  teams: LeadflowScheduleMapTeam[];
  selectedJobId: number | null;
  onJobSelect: (id: number) => void;
}) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const renderMap = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    infoWindowRef.current = new google.maps.InfoWindow();

    markersRef.current.forEach(marker => marker.setMap(null));
    polylinesRef.current.forEach(polyline => polyline.setMap(null));
    markersRef.current = [];
    polylinesRef.current = [];

    const teamColorMap = new Map(teams.map(team => [team.id, team.color ?? "#6366f1"]));
    const jobsByTeam = new Map<number, LeadflowScheduleMapJob[]>();
    for (const job of jobs) {
      if (!job.assignment) continue;
      const teamJobs = jobsByTeam.get(job.assignment.teamId) ?? [];
      teamJobs.push(job);
      jobsByTeam.set(job.assignment.teamId, teamJobs);
    }
    jobsByTeam.forEach(teamJobs => teamJobs.sort(
      (left, right) => (left.assignment?.routeOrder ?? 0) - (right.assignment?.routeOrder ?? 0),
    ));

    const bounds = new google.maps.LatLngBounds();
    let hasPoints = false;
    for (const team of teams) {
      if (!team.homeLat || !team.homeLng || team.isActive !== 1) continue;
      const position = { lat: team.homeLat, lng: team.homeLng };
      bounds.extend(position);
      hasPoints = true;
      const marker = new google.maps.Marker({
        position,
        map,
        title: `${team.name} (Home)`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: team.color ?? "#6366f1",
          fillOpacity: 0.3,
          strokeColor: team.color ?? "#6366f1",
          strokeWeight: 2,
        },
        zIndex: 1,
      });
      markersRef.current.push(marker);
    }

    const assignedJobs = Array.from(jobsByTeam.values()).flat().filter(job => Boolean(job.jobAddress));
    const unassignedJobs = jobsByTeam.size === 0
      ? jobs.slice(0, 20).filter(job => Boolean(job.jobAddress))
      : [];
    const totalGeocodes = assignedJobs.length + unassignedJobs.length;
    let completedGeocodes = 0;
    const maybeFitBounds = () => {
      completedGeocodes += 1;
      if (completedGeocodes === totalGeocodes && hasPoints && mapRef.current) {
        mapRef.current.fitBounds(bounds, { top: 40, right: 60, bottom: 160, left: 60 });
      }
    };

    for (const [teamId, teamJobs] of Array.from(jobsByTeam.entries())) {
      const color = teamColorMap.get(teamId) ?? "#6366f1";
      const team = teams.find(candidate => candidate.id === teamId);
      const routePoints: google.maps.LatLng[] = [];
      if (team?.homeLat && team.homeLng) {
        routePoints.push(new google.maps.LatLng(team.homeLat, team.homeLng));
      }

      for (let index = 0; index < teamJobs.length; index += 1) {
        const job = teamJobs[index];
        if (!job.jobAddress) continue;
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: job.jobAddress }, (results, status) => {
          if (status !== "OK" || !results?.[0]) {
            maybeFitBounds();
            return;
          }
          const position = results[0].geometry.location;
          bounds.extend(position);
          hasPoints = true;
          routePoints.push(position);
          const isSelected = job.id === selectedJobId;
          const marker = new google.maps.Marker({
            position,
            map,
            title: job.customerName ?? "Job",
            label: {
              text: String(index + 1),
              color: "white",
              fontSize: "11px",
              fontWeight: "bold",
            },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: isSelected ? 18 : 14,
              fillColor: color,
              fillOpacity: 1,
              strokeColor: "white",
              strokeWeight: 2,
            },
            zIndex: isSelected ? 10 : 5,
          });
          marker.addListener("click", () => {
            onJobSelect(job.id);
            infoWindowRef.current?.setContent(`
              <div style="font-family:sans-serif;padding:4px 0;max-width:200px">
                <div style="font-weight:600;font-size:13px">${job.customerName ?? "Job"}</div>
                <div style="color:#6b7280;font-size:12px;margin-top:2px">${job.jobAddress}</div>
                ${job.serviceDateTime ? `<div style="color:#6366f1;font-size:12px;margin-top:4px">${formatTime(new Date(job.serviceDateTime).getTime())}</div>` : ""}
              </div>
            `);
            infoWindowRef.current?.open(map, marker);
          });
          markersRef.current.push(marker);
          if (routePoints.length >= 2) {
            const polyline = new google.maps.Polyline({
              path: routePoints.slice(-2),
              geodesic: true,
              strokeColor: color,
              strokeOpacity: 0.7,
              strokeWeight: 3,
              map,
            });
            polylinesRef.current.push(polyline);
          }
          maybeFitBounds();
        });
      }
    }

    if (jobsByTeam.size === 0) {
      const geocoder = new google.maps.Geocoder();
      for (const job of unassignedJobs) {
        geocoder.geocode({ address: job.jobAddress! }, (results, status) => {
          if (status !== "OK" || !results?.[0]) {
            maybeFitBounds();
            return;
          }
          const position = results[0].geometry.location;
          bounds.extend(position);
          hasPoints = true;
          const marker = new google.maps.Marker({
            position,
            map,
            title: job.customerName ?? "Job",
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: "#9ca3af",
              fillOpacity: 1,
              strokeColor: "white",
              strokeWeight: 2,
            },
          });
          markersRef.current.push(marker);
          maybeFitBounds();
        });
      }
    }

    if (totalGeocodes === 0 && hasPoints && mapRef.current) {
      mapRef.current.fitBounds(bounds, { top: 40, right: 60, bottom: 160, left: 60 });
    }
  }, [jobs, onJobSelect, selectedJobId, teams]);

  return (
    <MapView
      onMapReady={renderMap}
      className="w-full h-full rounded-xl overflow-hidden"
      initialCenter={{ lat: 38.9, lng: -77.03 }}
      initialZoom={11}
    />
  );
}
