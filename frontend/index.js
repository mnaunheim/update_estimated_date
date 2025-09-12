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

    const jobsTable = base.getTableByNameIfExists(tableName);
    const workstationsTable = base.getTableByNameIfExists('Workstations');
    const view = jobsTable.getViewByNameIfExists('Grid view');
    const recordSort = useRecordIds(view);
    
    useEffect(() => {
        const fetchData = async ()  => {
            try {
                setLoading(true);
                console.log('Record Ids in view:' , recordSort);
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

    const opts = {
        sorts: [{field: 'SortID', direction: 'asc'}]
    };
    let jobsQuery = await jobsTable.selectRecordsAsync(opts);

    let jobs = mapJobRecords(jobsQuery.records);

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
        //Remove any jobs that are completed
        if(installStatus[0].value != 'Complete'){
            recordList.push({
                id: record.id,
                name: record.getCellValue('Job ID'),
                quantity: record.getCellValue('Unit Count') ? record.getCellValue('Unit Count')[0].value : 0,
                priority: record.getCellValue('SortID') || 999
            });
        }
    }
    return recordList
}

Date.prototype.addDays = function(days) {
    var date = new Date(this.valueOf());
    date.setDate(date.getDate() + days);
    return date;
}

async function CalculateEstimation(jobs, workstations, jobsTable) {
        try {       
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
            startDate = startDate.addDays(completion.startDate);
            let endDate = new Date();
            endDate = endDate.addDays(completion.endDate);
            jobsTable.updateRecordAsync(completion.orderId, {
            'Est. Start Date': new Date(startDate),
            'Est. Complete Date': new Date(endDate)
            });
        });

        /* Update records without triggering useRecords
        await Promise.all(
            results.completedOrders.map(async (order) => {
            let startDate = new Date();
            console.log(`Updating record ${order.id} with start date ${startDate.addDays(order.startDate)} and end date ${startDate.addDays(order.endDate)}`);
            await jobsTable.updateRecordAsync(order.id, {
                'Est. Start Date': startDate.addDays(order.startDate),
                'Est. Complete Date': startDate.addDays(order.endDate)
            });
            })
        );*/

        } catch (error) {
        console.error('Error:', error);
        } 
    };

initializeBlock(() => <TodoExtenstion />);
