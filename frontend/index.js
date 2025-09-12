import {initializeBlock,
    useBase,
    useRecords,
    useRecordIds
} from '@airtable/blocks/ui';
import React, {useEffect, useState} from 'react';
import './style.css';
import { calculatePipelineEstimation, formatForAirtable } from '../pipeline-estimation/pipelineEstimation';

function TodoExtenstion() {
    const base = useBase();

    const [tableName, setTableName] = useState('Jobs');
    const [loading, setLoading] = useState(true);
    const [workstations, setWorkstations] = useState([]);
    const [jobs, setJobs] = useState([]);

    const jobsTable = base.getTableByNameIfExists(tableName);
    const workstationsTable = base.getTableByNameIfExists('Workstations');
    const view = jobsTable.getViewByNameIfExists('Grid view');
    const recordSort = useRecordIds(view);
    
    useEffect(() => {
        const fetchData = async ()  => {
            try {
                setLoading(true);
                const { workstations, jobs } = await FetchInitialData(jobsTable, workstationsTable);
                                
                // Use the fetched data directly, not state
                CalculateEstimation(jobs, workstations, jobsTable);
            } catch (error) {
                console.error('Error fetching data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [recordSort]);

    if (loading) return <div>Updating records...</div>;
    return (
        <div>Records updated.</div>
    );
}
//Get initial data from Airtable
async function FetchInitialData(jobsTable, workstationsTable) {
    let workstationsQuery = await workstationsTable.selectRecordsAsync();    
    let workstations = workstationsQuery.records.map(record => ({
        id: record.id,
        name: record.getCellValue('Workstation Name'),
        hoursRequired: record.getCellValue('Time per Cabinet')
    }));
    setWorkstations(workstations);

    //Fetch jobs sorted by SortID
    const opts = {
        sorts: [{field: 'SortID', direction: 'asc'}]
    };
    let jobsQuery = await jobsTable.selectRecordsAsync(opts);

    let jobs = mapJobRecords(jobsQuery.records);
    setJobs(jobs);

    // Clean up queries
    workstationsQuery.unloadData();
    jobsQuery.unloadData();
    return {workstations, jobs};
}
//Map Airtable records to job objects
function mapJobRecords(records) {
    let recordList = [];
    for (let record of records) {
        let installStatus = record.getCellValue('Install Status');
        let moStatus = record.getCellValue('MO Status');
        let moTime = record.getCellValue('MO Time');
        //Remove any jobs that are completed
        if(installStatus[0].value != 'Complete' && moStatus != 'Complete' && moTime == 0) {
            recordList.push({
                id: record.id,
                name: record.getCellValue('Job ID'),
                moStatus: record.getCellValue('MO Status'),
                moTime: record.getCellValue('MO Time'),
                quantity: record.getCellValue('Unit Count') ? record.getCellValue('Unit Count')[0].value : 0,
                priority: record.getCellValue('SortID') || 999
            });
        }
    }
    return recordList
}

Date.prototype.addWorkDays = function(days) {
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

async function CalculateEstimation(jobs, workstations, jobsTable) {
        try {    
        // Calculate pipeline estimation       
        const results = calculatePipelineEstimation({
            hoursPerDay: 8,
            workstations,
            jobs
        });
        // Format for Airtable usage
        const formattedResults = formatForAirtable(results);

        // Update order records with completion dates
        formattedResults.orderCompletions.forEach(completion => {
            // Update the corresponding order record in Airtable
            let startDate = new Date();
            startDate = startDate.addWorkDays(completion.startDate-1);
            let endDate = new Date();
            endDate = endDate.addWorkDays(completion.endDate-1);
            jobsTable.updateRecordAsync(completion.orderId, {
            'Est. Start Date': new Date(startDate),
            'Est. Complete Date': new Date(endDate)
            });
        });

        } catch (error) {
        console.error('Error:', error);
        } 
    };

initializeBlock(() => <TodoExtenstion />);
