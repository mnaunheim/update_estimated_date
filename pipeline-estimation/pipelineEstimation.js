/**
 * Main estimation function for pipeline production
 * @param {Object} config - Configuration object
 * @param {number} config.hoursPerDay - Available working hours per day
 * @param {Array} config.workstations - Array of workstation objects
 * @param {Array} config.jobs - Array of order objects
 * @returns {Object} Estimation results with schedule and completion dates
 */
export function calculatePipelineEstimation(config) {
  const { hoursPerDay, workstations, jobs } = config;

  // Validate inputs
  if (!hoursPerDay || !workstations?.length || !jobs?.length) {
    if(!hoursPerDay) console.error('Missing hoursPerDay');
    if(!workstations?.length) console.error('Missing or empty workstations array');
    if(!jobs?.length) console.error('Missing or empty orders array');
    throw new Error('Missing required configuration: hoursPerDay, workstations, or orders');
  }

  // Sort orders by priority (lower number = higher priority)
  const sortedOrders = [...jobs].sort((a, b) => (a.sortid || 999) - (b.sortid || 999));
  
  // Initialize pipeline state
  const pipeline = workstations.map(ws => ({
    id: ws.id,
    name: ws.name,
    hoursRequired: ws.hoursRequired,
    currentOrder: null,
    remainingHours: 0
  }));

  // Track order progress through pipeline
  const orderProgress = sortedOrders.map(order => ({
    ...order,
    currentStation: 0,
    completed: false,
    startDate: null,
    endDate: null
  }));

  const schedule = [];
  let currentDay = 1;
  let ordersInProgress = [];
  let completedOrders = [];
  let nextOrderToStart = 0;

  // Continue until all orders are complete
  while (completedOrders.length < sortedOrders.length && currentDay <= 365) {
    const daySchedule = {
      day: currentDay,
      stations: [],
      ordersStarted: [],
      ordersCompleted: []
    };

    // Process each workstation for this day
    pipeline.forEach((station, stationIndex) => {
      let hoursWorked = 0;
      const stationActivity = [];

      while (hoursWorked < hoursPerDay) {
        // If station is idle, check if next order in sequence is ready
        if (!station.currentOrder) {
          // Check if there's an order ready for this station
          const readyOrder = ordersInProgress.find(order => 
            !order.completed && order.currentStation === stationIndex
          );

          if (readyOrder) {
            // Start processing this order at this station
            station.currentOrder = readyOrder;
            station.remainingHours = station.hoursRequired;
          } else if (stationIndex === 0 && nextOrderToStart < sortedOrders.length) {
            // First station can start new orders
            const newOrder = orderProgress[nextOrderToStart];
            station.currentOrder = newOrder;
            station.remainingHours = station.hoursRequired;
            newOrder.currentStation = 0;
            newOrder.startDate = currentDay;
            ordersInProgress.push(newOrder);
            daySchedule.ordersStarted.push({
              orderId: newOrder.id,
              orderName: newOrder.name
            });
            nextOrderToStart++;
          }
        }

        // Work on current order if any
        if (station.currentOrder) {
          const remainingDayHours = hoursPerDay - hoursWorked;
          const hoursToWork = Math.min(remainingDayHours, station.remainingHours);
          
          stationActivity.push({
            orderId: station.currentOrder.id,
            orderName: station.currentOrder.name,
            hours: hoursToWork
          });

          station.remainingHours -= hoursToWork;
          hoursWorked += hoursToWork;

          // Check if station work is complete
          if (station.remainingHours <= 0) {
            const order = station.currentOrder;
            
            // Move order to next station or complete it
            if (stationIndex === pipeline.length - 1) {
              // Order is complete
              order.completed = true;
              order.endDate = currentDay;
              completedOrders.push(order);
              daySchedule.ordersCompleted.push({
                orderId: order.id,
                orderName: order.name
              });
              ordersInProgress = ordersInProgress.filter(o => o.id !== order.id);
            } else {
              // Move to next station
              order.currentStation = stationIndex + 1;
            }
            
            station.currentOrder = null;
          }
        } else {
          // Station is idle
          if (stationActivity.length === 0) {
            stationActivity.push({ 
              type: 'idle', 
              hours: hoursPerDay - hoursWorked 
            });
          }
          break;
        }
      }

      daySchedule.stations.push({
        stationId: station.id,
        stationName: station.name,
        activity: stationActivity,
        currentOrderId: station.currentOrder?.id || null,
        currentOrderName: station.currentOrder?.name || null
      });
    });

    schedule.push(daySchedule);
    currentDay++;
  }

  return {
    schedule,
    completedOrders,
    totalDays: schedule.length
  };
}

/**
 * Helper function to get order completion dates
 * @param {Object} results - Results from calculatePipelineEstimation
 * @returns {Array} Array of orders with completion information
 */
export function getOrderCompletionDates(results) {
  return results.completedOrders.map(order => ({
    orderId: order.id,
    orderName: order.name,
    startDate: order.startDate,
    endDate: order.endDate,
    totalDays: order.endDate - order.startDate + 1
  }));
}

/**
 * Helper function to format results for Airtable
 * @param {Object} results - Results from calculatePipelineEstimation
 * @returns {Object} Formatted results for easy Airtable integration
 */
export function formatForAirtable(results) {
  return {
    // Basic summary
    totalDays: results.totalDays,
    totalOrders: results.completedOrders.length,
    
    // Order completion data for updating order records
    orderCompletions: getOrderCompletionDates(results),
    
    // Daily schedule (first 30 days) for overview
    dailySchedule: results.schedule.slice(0, 30).map(day => ({
      day: day.day,
      ordersStarted: day.ordersStarted.map(o => o.orderName),
      ordersCompleted: day.ordersCompleted.map(o => o.orderName),
      stationActivities: day.stations.map(station => ({
        stationName: station.stationName,
        currentOrder: station.currentOrderName,
        isIdle: !station.currentOrderName
      }))
    }))
  };
}

