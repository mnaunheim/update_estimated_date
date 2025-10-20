import {initializeBlock,
    useBase,
    useRecordIds
} from '@airtable/blocks/ui';
import React, {useEffect, useState} from 'react';
import './style.css';

function TodoExtenstion() {
    const base = useBase();

    const [tableName, setTableName] = useState('Jobs');
    const [loading, setLoading] = useState(true);


    const jobsTable = base.getTableByNameIfExists(tableName);
    const workstationsTable = base.getTableByNameIfExists('Workstations');
    const configTable = base.getTableByNameIfExists('Configuration');
    const view = jobsTable.getViewByNameIfExists('Sorted Grid');
    const girdRecords = useRecordIds(view);
    
    useEffect(() => {
        const fetchData = async ()  => {
            try {
                setLoading(true);
                const { workstations, jobs, holidays} = await FetchInitialData(jobsTable, workstationsTable, configTable);

                // Use the fetched data directly, not state
                CalculateEstimation(jobs, workstations, jobsTable, holidays);
            } catch (error) {
                console.error('Error fetching data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [girdRecords]);

    if (loading) return <div>Updating records...</div>;
    return (
        <div>Records updated.</div>
    );
}
//Get initial data from Airtable
async function FetchInitialData(jobsTable, workstationsTable, configTable) {
    let workstationsQuery = await workstationsTable.selectRecordsAsync();    
    let workstations = workstationsQuery.records.map(record => ({
        id: record.id,
        name: record.getCellValue('Workstation Name'),
        hoursRequired: record.getCellValue('Time per Cabinet'),
        setupTime: record.getCellValue('Setup Time') || 0
    }));
    
    //Fetch jobs sorted by SortID
    const opts = {
        sorts: [{field: 'Needs By', direction: 'asc'}]
    };
    let jobsQuery = await jobsTable.selectRecordsAsync(opts);

    let jobs = mapJobRecords(jobsQuery.records);

    let holidaysQuery = await configTable.selectRecordsAsync();
    let holidayRecords = holidaysQuery.records.map(record => ({
        name: record.getCellValue('Name'),
        value: record.getCellValue('Value')
    }));
    let holidays = '';
    holidayRecords.forEach(element => {
        if(element.name == 'Holidays'){
            holidays = element.value;
        }
    });

    // Clean up queries
    workstationsQuery.unloadData();
    jobsQuery.unloadData();
    holidaysQuery.unloadData();
    return {workstations, jobs, holidays};
}

//Map Airtable records to job objects
function mapJobRecords(records) {
    let recordList = [];
    for (let record of records) {
        let installStatus = record.getCellValue('Install Status');
        let moStatus = record.getCellValue('MO Status');
        let cabinetLine = record.getCellValue('Cabinet Line');
        //Remove any jobs that are completed'
        if(installStatus[0].value == 'Complete' || moStatus.name == 'Complete') {
            continue;
        }
        recordList.push({
            id: record.id,
            name: record.getCellValue('Job Name'),
            cabinetLine: cabinetLine ? cabinetLine[0].value : null,
            moStatus: moStatus,
            moTime: record.getCellValue('MO Time'),
            quantity: record.getCellValue('Unit Count') ? record.getCellValue('Unit Count')[0].value : 0,
            priority: record.getCellValue('Needs By') || 999,
        });
    }
    return recordList
}

Date.prototype.addWorkDays = function(days, holidays) {
    if(isNaN(days)) {
        console.log("Value provided for \"days\" was not a number");
        return
    }
    var newDate = new Date(this.valueOf());
    // Get the day of the week as a number (0 = Sunday, 1 = Monday, .... 6 = Saturday)
    var dow = newDate.getDay();
    var daysToAdd = parseInt(days);
    // If the current day is Sunday add one day
    if (dow == 0) {
        daysToAdd++;
    }
    //Determine if the new date is on a holiday
    const formatter = new Intl.DateTimeFormat('en-US', {
        month: '2-digit',
        day: '2-digit'
    });
    const formattedDate = formatter.format(newDate.setDate(newDate.getDate() + daysToAdd));

    var holidayArray = holidays ? holidays.split(', ') : [];
    if(holidayArray.includes(formattedDate)) {
        daysToAdd++;
    }

    // If the start date plus the additional days falls on or after the closest Saturday calculate weekends
    if (dow + daysToAdd >= 6) {
        //Subtract days in current working week from work days
        var remainingWorkDays = daysToAdd - (5 - dow);
        //Add current working week's weekend
        daysToAdd += 2;
        if (remainingWorkDays > 5) {
            //Add two days for each working week by calculating how many weeks are included
            daysToAdd += 2 * Math.floor(remainingWorkDays / 5);
            //Exclude final weekend if the remainingWorkDays resolves to an exact number of weeks
            if (remainingWorkDays % 5 == 0)
                daysToAdd -= 2;
        }
    }

    return newDate.setDate(newDate.getDate() + daysToAdd);
}

async function CalculateEstimation(jobs, workstations, jobsTable, holidays) {
        try {    
        const results = calculateJobEstimates(8, workstations, jobs);
        
        // Update order records with completion dates
        results.orderCompletions.forEach(completion => {
            // Update the corresponding order record in Airtable
            if(completion.cabinetLine == "JG Customs") {
                let startDate = new Date();
                startDate = startDate.addWorkDays(completion.startDate-1, holidays);
                let endDate = new Date();
                endDate = endDate.addWorkDays(completion.endDate-1, holidays);
                jobsTable.updateRecordAsync(completion.orderId, {
                'Est. Start Date': new Date(startDate),
                'Est. Complete Date': new Date(endDate),
                'Days to Complete': completion.totalDays
                });
            }else{
                jobsTable.updateRecordAsync(completion.orderId, {
                    'Est. Start Date': null,
                    'Est. Complete Date': null,
                    'Days to Complete': null
                    });
            }
        });

        } catch (error) {
        console.error('Error:', error);
        } 
    };
function calculateJobEstimates(hoursPerDay, workstations, jobs) {
    let completedJobs = [];

    const totalPerCabinet = workstations.reduce((sum, ws) => sum + (ws.hoursRequired || 0), 0);
    const totalSetupTime = workstations.reduce((sum, ws) => sum + (ws.setupTime || 0), 0);
    //console.log('Total setup time:', totalSetupTime);
    //console.log('Total hours per cabinet:', totalPerCabinet);
    let startDate = 0
    let runningHours = 0 
    for (let job of jobs){      
        let jobTotalHours = job.cabinetLine == "JG Customs" ? (job.quantity || 0) * totalPerCabinet + totalSetupTime : 0;

        //Set job hours if they already have MO Time entered
        if(job.moStatus && job.moStatus.name != 'Not Started' && job.moTime){
            jobTotalHours = job.moTime;
        }

        job.totalHours = jobTotalHours;
        job.totalDays = Math.ceil(jobTotalHours / (hoursPerDay*workstations.length));
        job.startDate = startDate; 
        job.endDate = startDate + job.totalDays;
        job.orderId = job.id;
        completedJobs.push(job);

        runningHours += jobTotalHours;
        let remainingHours = runningHours % (hoursPerDay*workstations.length);

        startDate += Math.floor(runningHours / (hoursPerDay*workstations.length));
        if(remainingHours >0){
            runningHours = remainingHours;
        }   
    }

    return { orderCompletions: completedJobs }; 
}

initializeBlock(() => <TodoExtenstion />);
