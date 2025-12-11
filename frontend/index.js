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
    const [error, setError] = useState(null);

    const jobsTable = base.getTableByNameIfExists(tableName);
    const workstationsTable = base.getTableByNameIfExists('Workstations');
    const configTable = base.getTableByNameIfExists('Configuration');
    const view = jobsTable.getViewByNameIfExists('Sorted Grid');
    const girdRecords = useRecordIds(view);

    if (!jobsTable || !workstationsTable || !configTable) {
        return <div>Error: Required base not found. Base must be named 'Jobs'.</div>;
    }
    if (!view) {
        return <div>Error: 'Sorted Grid' view not found within the Jobs base.</div>;
    }
    
    useEffect(() => {
        const fetchData = async ()  => {
            try {
                setLoading(true);
                const { workstations, jobs, holidays} = await FetchInitialData(jobsTable, workstationsTable, configTable);
        
                // Use the fetched data directly, not state
                CalculateEstimation(jobs, workstations, jobsTable, holidays);
            } catch (error) {
                console.error('Error fetching data:', error);
                setError(`Error fetching data: ${error.message}`);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [girdRecords]);

    if (loading) return <div>Updating records...</div>;
    if(error) return <div>{error}</div>;
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
        if((installStatus && installStatus.length > 0 && installStatus[0].value == 'Complete') 
            || (moStatus && moStatus.name == 'Complete')){
            continue;
        }

        recordList.push({
            id: record.id,
            name: record.getCellValue('Job Name'),
            cabinetLine: (cabinetLine && cabinetLine.length > 0) ? cabinetLine[0].value : null,
            moStatus: moStatus,
            moTime: record.getCellValue('MO Time'),
            quantity: record.getCellValue('Unit Count') ? record.getCellValue('Unit Count')[0].value : 0,
            priority: record.getCellValue('Needs By') || 999,
        });
    }
    return recordList
}

function addBusinessDays(daysToAdd, holidays = [], startDate = new Date()) {
  // Normalize holidays to date strings (YYYY-MM-DD) for easy comparison
  const holidaySet = new Set(
    holidays.map(h => {
      const d = h instanceof Date ? h : new Date(h);
      return d.toISOString().split('T')[0];
    })
  );
  
  // Helper function to check if a date is a weekend
  const isWeekend = (date) => {
    const day = date.getDay();
    return day === 0 || day === 6; // Sunday or Saturday
  };
  
  // Helper function to check if a date is a holiday
  const isHoliday = (date) => {
    const dateStr = date.toISOString().split('T')[0];
    return holidaySet.has(dateStr);
  };
  
  // Create a new date object to avoid mutating the input
  const result = new Date(startDate);
  let addedDays = 0;
  let weekendsSkipped = 0;
  let holidaysSkipped = 0;
  
  // Add days until we've added the required number of business days
  while (addedDays < daysToAdd) {
    result.setDate(result.getDate() + 1);
    if(addedDays + 1 == daysToAdd && isWeekend(result)){
        weekendsSkipped++;
    }
    if(addedDays + 1 == daysToAdd && isHoliday(result)){
        holidaysSkipped++;
    }
    if (!isWeekend(result)&& !isHoliday(result)) {
      addedDays++;
    }
  }
  
  return {
    date: result,
    skippedDays: weekendsSkipped + holidaysSkipped,
  };
}


async function CalculateEstimation(jobs, workstations, jobsTable, holidays) {   
    try {
        var holidayArray = holidays ? holidays.split(', ') : [];
        const results = calculateJobEstimates(8, workstations, jobs, holidayArray);
        
        // Use Promise.all to handle async updates properly
        const updatePromises = results.orderCompletions.map(async (completion) => {
            try {
                if(completion.cabinetLine == "JG Customs") {
                    await jobsTable.updateRecordAsync(completion.orderId, {
                        'Est. Start Date': completion.startDate,
                        'Est. Complete Date': completion.endDate,
                        'Days to Complete': completion.totalDays
                    });
                } else {
                    await jobsTable.updateRecordAsync(completion.orderId, {
                        'Est. Start Date': null,
                        'Est. Complete Date': null,
                        'Days to Complete': null
                    });
                }
            } catch (error) {
                console.error(`Error updating record ${completion.orderId}:`, error);
                // Continue with other updates even if one fails
            }
        });
        
        // Wait for all updates to complete
        await Promise.all(updatePromises);
        
    } catch (error) {
        console.error('Error when CalculateEstimation:', error);
        throw error; // Re-throw to be handled by caller
    }
}
function calculateJobEstimates(hoursPerDay, workstations, jobs, holidayArray) {
    let completedJobs = [];

    const totalPerCabinet = workstations.reduce((sum, ws) => sum + (ws.hoursRequired || 0), 0);
    const totalSetupTime = workstations.reduce((sum, ws) => sum + (ws.setupTime || 0), 0);
    //console.log('Total setup time:', totalSetupTime);
    //console.log('Total hours per cabinet:', totalPerCabinet);
    let startDate = 0
    let runningHours = 0 
    for (let job of jobs){      
        let jobTotalHours = job.cabinetLine == "JG Customs" ? ((job.quantity || 0) * totalPerCabinet) + totalSetupTime : 0;

        //Set job hours if they already have MO Time entered
        if(job.moStatus && job.moStatus.name != 'Not Started' && job.moTime){
            jobTotalHours = job.moTime;
        }
        job.totalHours = jobTotalHours;
        job.totalDays = Math.ceil(jobTotalHours / (hoursPerDay*workstations.length));

        let startDateObj = addBusinessDays(startDate, holidayArray);
        let endDateObj = addBusinessDays(startDate + job.totalDays, holidayArray);
        job.startDate = startDateObj.date; 
        job.endDate = endDateObj.date;
        job.orderId = job.id;
        completedJobs.push(job);

        runningHours += jobTotalHours;
        let remainingHours = runningHours % (hoursPerDay*workstations.length);

        startDate += Math.floor(runningHours / (hoursPerDay*workstations.length));
        startDate += startDateObj.skippedDays+endDateObj.skippedDays; //Account for weekends/holidays

        if(remainingHours >0){
            runningHours = remainingHours;
        }   
    }

    return { orderCompletions: completedJobs }; 
}

initializeBlock(() => <TodoExtenstion />);
