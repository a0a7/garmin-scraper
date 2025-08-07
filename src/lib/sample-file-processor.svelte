<script lang="ts">
    import { onMount } from 'svelte';
    import { page } from '$app/stores';
    import { derived } from 'svelte/store';
    import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import AppSidebar from "$lib/components/app-sidebar.svelte";
    import CalendarPage from "$lib/pages/CalendarPage.svelte";
    import ListPage from "$lib/pages/ListPage.svelte";
    import WeightsVolumePage from "$lib/pages/WeightsVolumePage.svelte";
    import WeightsStatsPage from "$lib/pages/WeightsStatsPage.svelte";
    import CyclingStatsPage from "$lib/pages/CyclingStatsPage.svelte";
    import CyclingWeatherPage from "$lib/pages/CyclingWeatherPage.svelte";
    import CyclingMapPage from "$lib/pages/CyclingMapPage.svelte";
    import { Input } from "$lib/components/ui/input/index.js";
    import { Label } from "$lib/components/ui/label/index.js";
    import Button from '$lib/components/ui/button/button.svelte';
    import * as Card from '$lib/components/ui/card/';
    import HomePage from '$lib/pages/HomePage.svelte';
    import { Download } from 'lucide-svelte';
    import fileSaver from 'file-saver';
    import Papa from 'papaparse';
    import YAML from 'yaml';
    import { useMetric } from '../stores/useMetric';
	import WeightsSummaryPage from '$lib/pages/WeightsSummaryPage.svelte';

    let p: string | null = $state(null);
    let file: File | null = null;
    let fileContent: string | null = null;
    let fileUploaded: boolean = $state(false);
    let allActivities: any[] = $state([]);
    let volumeType: string = $state('weight');
    let totalVolume: number = $state(0);
    let maxActivation = $state(0);
    let exerciseMuscleMap: { [key: string]: { primaryMuscles: string[], secondaryMuscles: string[] } } = $state({});
    let weightUnit: string = $state('kg');
    let activities: any = $state([]);
    let useMetricValue = $state(true);

    const allMuscles = [
        "ABDUCTORS",
        "ABS",
        "ADDUCTORS",
        "BICEPS",
        "CALVES",
        "CHEST",
        "FOREARM",
        "GLUTES",
        "HAMSTRINGS",
        "HIPS",
        "LATS",
        "LOWER_BACK",
        "NECK",
        "OBLIQUES",
        "QUADS",
        "SHOULDERS",
        "TRAPS",
        "TRICEPS",
    ];

    let muscleActivation = $state(allMuscles.reduce((acc, muscle) => {
        acc[muscle] = 0;
        return acc;
    }, {} as { [key: string]: number }));

    const queryParam = derived(page, $page => {
        const urlParams = new URLSearchParams($page.url.search);
        return urlParams.get('p') ?? 'home';
    });

    onMount(() => {
        const unsubscribe = queryParam.subscribe(value => {
            p = value;
        });

        const cachedActivities = localStorage.getItem('activities');
        if (cachedActivities && cachedActivities.length > 2) {
            activities = JSON.parse(cachedActivities);
            fileUploaded = true;
        }

        useMetric.subscribe(value => {
            useMetricValue = value;
        });

        return () => unsubscribe();
    });

    function formatPageName(page: string | null): string {
        if (!page) return '';
        switch (page) {
            case 'list':
                return 'All Exercises';
            case 'weights-volume':
                return 'Muscle Breakdown';
            case 'weights-charts':
                return 'Metric Distribution Charts';
            case 'weights-stats':
                return 'Weightlifting Statistics Summary';
            case 'cycling-stats':
                return 'Cycling Statistics';
            case 'cycling-weather':
                return 'Cycling Weather';
            case 'cycling-map':
                return 'Cycling Map';
            default:
                return page.charAt(0).toUpperCase() + page.slice(1);
        }
    }

    function handleFileChange(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            file = input.files[0];
        }
    }

    function handleFileUpload(event: Event) {
        event.preventDefault();
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                fileContent = reader.result as string;
                if (file && validateFileContent(fileContent, file.type)) {
                    fileUploaded = true;
                    if (file) {
                        parseFileContent(fileContent, file.type);
                    }
                } else {
                    alert('Invalid file content - Upload JSON or YAML with the correct format');
                }
            };
            reader.readAsText(file);
        }
    }

    function validateFileContent(content: string, fileType: string): boolean {
        try {
            let data;
            if (fileType === 'application/json') {
                data = JSON.parse(content);
            } else if (fileType === 'text/yaml' || fileType === 'application/x-yaml' || fileType === 'application/yaml' || fileType === 'text/x-yaml') {
                data = YAML.parse(content);
            } else {
                return false;
            }
            return Array.isArray(data) && (data.every(activity => activity.id && activity.name) || data.every(activity => activity.activityId && activity.activityName));
        } catch (e) {
            return false;
        }
    }

    function flattenActivities(activities: any[]) {
        return activities.map(activity => {
            const flattened = { ...activity };
            if (activity.exerciseSets) {
                flattened.exerciseSets = activity.exerciseSets.map((set: any) => `${set.name} (${set.reps} reps, ${set.weight} kg)`).join('; ');
            }
            return flattened;
        });
    }

    function parseFileContent(content: string, fileType: string) {
        let data;
        if (fileType === 'application/json') {
            data = JSON.parse(content);
        } else if (fileType === 'text/yaml' || fileType === 'application/x-yaml' || fileType === 'application/yaml' || fileType === 'text/x-yaml') {
            data = YAML.parse(content);
        } else {
            alert('Unsupported file type - Upload JSON or YAML');
            return;
        }

        const allActivitiesSet = new Set();
        if (Array.isArray(data) && data.every(activity => activity.id && activity.name)) {
            activities = data;
        } else if (Array.isArray(data) && data.every(activity => activity.activityId && activity.activityName)) {
            data.forEach((activity: any) => {
                if (!allActivitiesSet.has(activity.activityId)) {
                    allActivitiesSet.add(activity.activityId);
                    allActivities.push(activity);
                }
            });
            processMuscleInformation();
        }
    }

    async function fetchExerciseMuscleMap() {
        const response = await fetch('exercise-muscle-groups.json');
        exerciseMuscleMap = await response.json();
    }

    async function processMuscleInformation() {
        await fetchExerciseMuscleMap();

        activities = allActivities.map(activity => {
            if (activity.activityType?.typeKey === 'strength_training' || activity.type === 'strength_training') {
                const activityExerciseSets: { name: string; reps: number; weight: number; time: string }[] = [];
                if (Array.isArray(activity.fullExerciseSets) || Array.isArray(activity.exerciseSets)) {
                    (activity.fullExerciseSets || activity.exerciseSets).forEach((exerciseSet: any) => {
                        exerciseSet.exercises.forEach((exercise: any) => {
                            const exerciseData = {
                                name: exercise.name,
                                reps: exerciseSet.repetitionCount || exerciseSet.reps,
                                weight: exerciseSet.weight || 0,
                                time: exerciseSet.startTime || exerciseSet.time
                            };
                            activityExerciseSets.push(exerciseData);
                        });
                    });
                }
                return {
                    id: activity.activityId || activity.id,
                    name: activity.activityName || activity.name,
                    startTime: activity.startTimeLocal || activity.startTime,
                    time: activity.duration || activity.time,
                    movingTime: activity.movingDuration || activity.movingTime,
                    exerciseSets: activityExerciseSets,
                    totalReps: activity.totalReps,
                    totalSets: activity.totalSets,
                    calories: activity.calories,
                    sweat: activity.waterEstimated || activity.sweat,
                    avgHR: activity.averageHR || activity.avgHR,
                    maxHR: activity.maxHR,
                    zonesHR: activity.zonesHR || {
                        z0: activity.hrTimeInZone_0,
                        z1: activity.hrTimeInZone_1,
                        z2: activity.hrTimeInZone_2,
                        z3: activity.hrTimeInZone_3,
                        z4: activity.hrTimeInZone_4,
                        z5: activity.hrTimeInZone_5,
                    },
                };
            } else {
                return {
                    id: activity.activityId || activity.id,
                    name: activity.activityName || activity.name,
                    type: activity.activityType?.typeKey || activity.type,
                    startTime: activity.startTimeLocal || activity.startTime,
                    time: activity.duration || activity.time,
                    movingTime: activity.movingDuration || activity.movingTime,
                    dist: activity.distance || activity.dist,
                    avgSpeed: activity.averageSpeed || activity.avgSpeed,
                    elevationGain: activity.elevationGain,
                    calories: activity.calories,
                    sweat: activity.waterEstimated || activity.sweat,
                    avgHR: activity.averageHR || activity.avgHR,
                    maxHR: activity.maxHR,
                    zonesHR: activity.zonesHR || {
                        z0: activity.hrTimeInZone_0,
                        z1: activity.hrTimeInZone_1,
                        z2: activity.hrTimeInZone_2,
                        z3: activity.hrTimeInZone_3,
                        z4: activity.hrTimeInZone_4,
                        z5: activity.hrTimeInZone_5,
                    },
                    startLatLng: activity.startLatLng || [activity.startLatitude, activity.startLongitude],
                    endLatLng: activity.endLatLng || [activity.endLatitude, activity.endLongitude],
                    location: activity.location || activity.locationName,
                };
            }
        });

        maxActivation = Math.max(...Object.values(muscleActivation));
        localStorage.setItem('activities', JSON.stringify(activities));
    }

</script>

<Sidebar.Provider>
    <AppSidebar />
    <Sidebar.Inset class="max-w-full">
        <header class="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <Sidebar.Trigger class="-ml-1" />
            <Separator orientation="vertical" class="mr-2 h-4" />
            <Breadcrumb.Root>
                <Breadcrumb.List>
                    <Breadcrumb.Item>
                        <Breadcrumb.Page>{formatPageName(p)}</Breadcrumb.Page>
                    </Breadcrumb.Item>
                </Breadcrumb.List>
            </Breadcrumb.Root>
        </header>
        <div class="w-full max-w-full">
            {#if !fileUploaded}
                <div class="flex flex-col items-center mt-16">
                    <h2 class="font-bold text-3xl">Upload Data</h2>
                    <form class="flex flex-col gap-1 max-w-sm mt-6" onsubmit={handleFileUpload}>
                        <Label for="fileUpload">json</Label>
                        <Input id="fileUpload" type="file" onchange={handleFileChange} />
                        <Button type="submit" class="mx-auto px-8 mt-4">Upload File</Button>
                    </form>
                    <p class="max-w-80 pt-6 text-center">To use this website you need to export your Garmin activities using the Garmin Workout Downloader <a class="link" href="https://chromewebstore.google.com/detail/garmin-workout-downloader/hpimimpdkghmejbcldfccdbaebjifnkk" target="_blank" rel="noopener noreferrer">Chrome</a> or <a class="link" href="https://addons.mozilla.org/en-US/firefox/addon/garmin-workout-downloader/" target="_blank" rel="noopener noreferrer">Firefox</a> extension and upload the resultant file here.</p>
                </div>
            {:else}
            {#if p === 'home'}
                <HomePage {activities} />
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-36">
                    <div class="flex flex-col items-center lg:ml-auto">
                        <h2 class="font-bold text-3xl">Export Processed Data</h2>
                        <div class="mt-6 flex gap-2">
                            <Button class="" variant="outline" onclick={() => { const yaml = YAML.stringify(activities); const blob = new Blob([yaml], { type: 'text/yaml;charset=utf-8;' }); fileSaver.saveAs(blob, 'all_activities.yaml'); }}><Download /> YAML</Button>
                            <Button class="" variant="outline" onclick={() => { const json = JSON.stringify(activities, null, 2); const blob = new Blob([json], { type: 'application/json;charset=utf-8;' }); fileSaver.saveAs(blob, 'all_activities.json'); }}><Download /> JSON</Button>

                            <Button class="" variant="outline" onclick={() => { 
                                const flattenedActivities = flattenActivities(activities);
                                const csv = Papa.unparse(flattenedActivities); 
                                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); 
                                fileSaver.saveAs(blob, 'all_activities.csv'); 
                            }}><Download /> CSV</Button>
                            <Button class="" variant="outline" onclick={() => { 
                                const flattenedActivities = flattenActivities(activities);
                                const tsv = Papa.unparse(flattenedActivities, { delimiter: '\t' }); 
                                const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8;' }); 
                                fileSaver.saveAs(blob, 'all_activities.tsv'); 
                            }}><Download /> TSV</Button>
                            </div>
                        <p class="max-w-80 pt-6 text-center">Note: CSV & TSV Formats are less precise than JSON & YAML, and don't store data about workout sets & HR zones</p>
                    </div><!--
                    <div class="flex flex-col items-center">
                        <h2 class="font-bold text-3xl">Upload More Data</h2>
                        <form class="flex gap-1 max-w-sm mt-6" onsubmit={handleFileUpload}>
                            <Input id="fileUpload" type="file" onchange={handleFileChange} />
                            <Button type="submit" variant="outline" class="ml-4">Upload File</Button>
                        </form>
                        <p class="max-w-80 pt-6 text-center">You can upload another json file to update the list of activities</p>
                    </div>-->
                    <div class="flex flex-col items-center lg:mr-auto">
                        <h2 class="font-bold text-3xl">Delete Data & Clear Cache</h2>
                        <Button variant="outline" class="ml-4 mt-6" onclick={() => {localStorage.removeItem('activities'); location.reload()}}>Remove Uploaded Data</Button>                        <p class="max-w-80 pt-6 text-center">You can remove your data if you want to update your activities or if something isn't working right.</p>
                    </div>
                </div>
            {:else if p === 'calendar'}
                <CalendarPage {activities} />
            {:else if p === 'list'}
                <ListPage {activities} />
            {:else if p === 'weights-stats'}
                <WeightsSummaryPage 
                    {activities} 
                    {volumeType}
                    {weightUnit}
                />
            {:else if p === 'weights-volume'}
                <WeightsVolumePage
                    {activities}
                    {volumeType}
                    {weightUnit}
                />
            {:else if p === 'weights-charts'}
                <WeightsStatsPage {activities} />
            {:else if p === 'cycling-stats'}
                <CyclingStatsPage {activities} />
            {:else if p === 'cycling-weather'}
                <CyclingWeatherPage {activities} />
            {:else if p === 'cycling-map'}
                <CyclingMapPage {activities} />
            {:else}
                <p>Page not found</p>
            {/if}
        {/if}
    </div>
    </Sidebar.Inset>
</Sidebar.Provider> 